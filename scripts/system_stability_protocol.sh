#!/bin/bash

# System Stability Protocol v1.0
# Systematic investigation and resolution of service failures

log_message() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >> /var/log/system_stability.log
}

investigate_taildrop_watcher() {
    log_message "Investigating taildrop-watcher.service"
    
    # Check service status
    systemctl status taildrop-watcher.service
    
    # Verify script existence
    if [ ! -f "/home/head/navada-1/scripts/taildrop-watcher.sh" ]; then
        log_message "CRITICAL: taildrop-watcher.sh script missing"
        return 1
    fi
    
    # Ensure executable permissions
    chmod +x /home/head/navada-1/scripts/taildrop-watcher.sh
    
    # Restart service
    systemctl restart taildrop-watcher.service
    
    # Check new status
    systemctl is-active taildrop-watcher.service
}

main() {
    log_message "Starting system stability protocol"
    
    # Retry mechanism
    max_attempts=5
    attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        log_message "Attempt $attempt of $max_attempts"
        
        investigate_taildrop_watcher
        result=$?
        
        if [ $result -eq 0 ]; then
            log_message "Service stabilized successfully"
            exit 0
        fi
        
        sleep 10
        ((attempt++))
    done
    
    log_message "FAILED: Could not stabilize taildrop-watcher.service"
    exit 1
}

main