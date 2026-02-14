# Railway Node Connectivity Check (Windows)
# Safe verification without disrupting Alex

$PROJECT_ID = "a4af4615-ff5c-4f88-917e-3a4099269eef"
$ENVIRONMENT_ID = "663f2d4a-6d62-4f24-a698-bea71d581fca"

$Services = @{
    "alex-main" = @{
        ID = "71e94c37-64c6-44f2-a5c8-7ae2a1b641f4"
        Name = "Alex Main Service"
        Critical = $true
    }
    "postgres" = @{
        ID = "18f45778-a301-48ae-bc1d-4b8a24c7a246"
        Name = "PostgreSQL Database"
        Critical = $true
    }
    "chromadb" = @{
        ID = "be536d17-091f-49c3-a141-22efcd867dee"
        Name = "ChromaDB (RAG)"
        Critical = $false
    }
    "nodejs" = @{
        ID = "61c90c33-c623-4f05-8e14-1aab785f18fa"
        Name = "Node.js Service"
        Critical = $false
    }
    "http-nodejs" = @{
        ID = "7758afc6-b6a3-4fcc-99f6-77eb83b70277"
        Name = "HTTP Node.js"
        Critical = $false
    }
    "upstash" = @{
        ID = "e37177e0-e16b-4fbf-b95c-4b8ca8b37ae4"
        Name = "Upstash Redis"
        Critical = $true
    }
    "anythingllm" = @{
        ID = "7d0ca97a-5862-4fc7-834a-0cf7c656b3bd"
        Name = "AnythingLLM"
        Critical = $false
    }
}

Write-Host "🔍 Railway Node Connectivity Check" -ForegroundColor Blue
Write-Host "This check will not disrupt Alex's operation`n" -ForegroundColor Cyan

Write-Host "Project: $PROJECT_ID" -ForegroundColor Cyan
Write-Host "Environment: $ENVIRONMENT_ID`n" -ForegroundColor Cyan

# Function to check service status
function Check-Service {
    param(
        [string]$ServiceID,
        [string]$ServiceName,
        [bool]$Critical
    )

    Write-Host "Checking $ServiceName..." -ForegroundColor Yellow

    try {
        # Get service status via Railway CLI
        $statusCmd = "railway status --project=$PROJECT_ID --environment=$ENVIRONMENT_ID --service=$ServiceID --json 2>$null"
        $statusResult = Invoke-Expression $statusCmd | ConvertFrom-Json

        if ($statusResult) {
            Write-Host "  ✓ Service is deployed" -ForegroundColor Green

            # Check recent logs for errors (last 20 lines)
            $logsCmd = "railway logs --project=$PROJECT_ID --environment=$ENVIRONMENT_ID --service=$ServiceID --limit=20 2>$null"
            $logs = Invoke-Expression $logsCmd

            $errorCount = ($logs | Select-String -Pattern "error|fatal|failed" -CaseSensitive:$false).Count
            $successCount = ($logs | Select-String -Pattern "connected|ready|listening|started" -CaseSensitive:$false).Count

            if ($errorCount -gt 0) {
                Write-Host "  ⚠ Found $errorCount error(s) in recent logs" -ForegroundColor Yellow
            }

            if ($successCount -gt 0) {
                Write-Host "  ✓ Found $successCount success indicator(s)" -ForegroundColor Green
            }

            return @{
                Success = $true
                ServiceName = $ServiceName
                Critical = $Critical
                Errors = $errorCount
                Status = "Running"
            }
        }
    }
    catch {
        if ($Critical) {
            Write-Host "  ✗ Critical service not accessible: $_" -ForegroundColor Red
        } else {
            Write-Host "  ⚠ Service not accessible: $_" -ForegroundColor Yellow
        }

        return @{
            Success = $false
            ServiceName = $ServiceName
            Critical = $Critical
            Error = $_.Exception.Message
            Status = "Unknown"
        }
    }
}

# Check each service
$results = @()
$criticalFailures = 0
$nonCriticalFailures = 0

foreach ($service in $Services.GetEnumerator()) {
    $result = Check-Service -ServiceID $service.Value.ID -ServiceName $service.Value.Name -Critical $service.Value.Critical

    if (-not $result.Success) {
        if ($result.Critical) {
            $criticalFailures++
        } else {
            $nonCriticalFailures++
        }
    }

    $results += $result
    Write-Host ""
}

# Check Alex's E2E endpoint directly via Railway
Write-Host "=== Checking Alex E2E Endpoint ===" -ForegroundColor Blue

try {
    # Try to access Alex's E2E endpoint
    $alexCmd = "railway run --project=$PROJECT_ID --environment=$ENVIRONMENT_ID --service=$($Services['alex-main'].ID) -- curl -s http://127.0.0.1:9090/api/e2e 2>$null"
    $e2eResult = Invoke-Expression $alexCmd | ConvertFrom-Json

    if ($e2eResult.ok) {
        Write-Host "✓ E2E check passed - all services connected" -ForegroundColor Green

        foreach ($check in $e2eResult.checks.PSObject.Properties) {
            $status = if ($check.Value.ok) { "✓" } else { "✗" }
            $color = if ($check.Value.ok) { "Green" } else { "Red" }
            Write-Host "  $status $($check.Name): $($check.Value.status)" -ForegroundColor $color
        }
    } else {
        Write-Host "⚠ E2E check reported issues" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "⚠ Could not run E2E check: $_" -ForegroundColor Yellow
}

Write-Host "`n=== Summary ===" -ForegroundColor Blue

if ($criticalFailures -eq 0) {
    Write-Host "✓ All critical services are operational" -ForegroundColor Green
} else {
    Write-Host "✗ $criticalFailures critical service(s) have issues" -ForegroundColor Red
}

if ($nonCriticalFailures -gt 0) {
    Write-Host "⚠ $nonCriticalFailures non-critical service(s) have issues" -ForegroundColor Yellow
}

# Provide recommendations
if ($criticalFailures -gt 0 -or $nonCriticalFailures -gt 0) {
    Write-Host "`n=== Recommendations ===" -ForegroundColor Blue
    Write-Host "1. Check Railway dashboard for service status" -ForegroundColor Cyan
    Write-Host "2. Use 'railway logs' to view detailed error messages" -ForegroundColor Cyan
    Write-Host "3. Verify environment variables are set correctly" -ForegroundColor Cyan
    Write-Host "4. Ensure all services are deployed and running" -ForegroundColor Cyan

    if ($results | Where-Object { $_.ServiceName -eq "ChromaDB (RAG)" -and -not $_.Success }) {
        Write-Host "`n⚠ ChromaDB is down - RAG features will be degraded but Alex will continue working" -ForegroundColor Yellow
    }
}

# Save results
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$reportPath = "railway_check_$timestamp.json"

$report = @{
    Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    ProjectID = $PROJECT_ID
    EnvironmentID = $ENVIRONMENT_ID
    Results = $results
    CriticalFailures = $criticalFailures
    NonCriticalFailures = $nonCriticalFailures
}

$report | ConvertTo-Json -Depth 3 | Out-File -FilePath $reportPath -Encoding UTF8
Write-Host "`nResults saved to: $reportPath" -ForegroundColor Blue