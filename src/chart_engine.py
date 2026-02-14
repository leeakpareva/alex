#!/usr/bin/env python3
"""
Enhanced Chart Generation Engine for Alex
Provides advanced data visualization capabilities with multiple libraries
"""

import sys
import json
import base64
from io import BytesIO
from pathlib import Path

# Essential libraries always available
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns

# Enhanced visualizations
try:
    import plotly.graph_objects as go
    import plotly.express as px
    from plotly.subplots import make_subplots
    PLOTLY_AVAILABLE = True
except ImportError:
    PLOTLY_AVAILABLE = False

try:
    import altair as alt
    ALTAIR_AVAILABLE = True
except ImportError:
    ALTAIR_AVAILABLE = False

# Statistical and ML tools
try:
    from scipy import stats
    from sklearn.preprocessing import StandardScaler
    from sklearn.decomposition import PCA
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

# Set style defaults
sns.set_theme(style="whitegrid", palette="husl")
plt.rcParams['figure.figsize'] = (12, 8)
plt.rcParams['figure.dpi'] = 150
plt.rcParams['font.size'] = 11
plt.rcParams['axes.titlesize'] = 14
plt.rcParams['axes.labelsize'] = 12

class ChartEngine:
    """Enhanced chart generation with multiple visualization libraries"""

    def __init__(self, output_path):
        self.output_path = Path(output_path)
        self.output_path.parent.mkdir(parents=True, exist_ok=True)

    def create_financial_dashboard(self, data):
        """Create a comprehensive financial dashboard"""
        if PLOTLY_AVAILABLE:
            fig = make_subplots(
                rows=2, cols=2,
                subplot_titles=('Portfolio Performance', 'Sector Distribution',
                               'Price Movement', 'Volume Analysis'),
                specs=[[{'type': 'scatter'}, {'type': 'pie'}],
                       [{'type': 'bar'}, {'type': 'scatter'}]]
            )

            # Add traces based on data structure
            # This is a template that can be customized based on actual data

            fig.update_layout(
                title_text="Financial Dashboard",
                showlegend=True,
                height=800,
                template='plotly_white'
            )

            fig.write_image(str(self.output_path))
            return True
        else:
            # Fallback to matplotlib
            fig, axes = plt.subplots(2, 2, figsize=(14, 10))
            fig.suptitle('Financial Dashboard', fontsize=16)

            # Create subplots based on data
            plt.tight_layout()
            plt.savefig(self.output_path, dpi=150, bbox_inches='tight')
            plt.close()
            return True

    def create_correlation_heatmap(self, df, title="Correlation Matrix"):
        """Generate correlation heatmap with annotations"""
        plt.figure(figsize=(12, 10))

        # Calculate correlation matrix
        corr_matrix = df.corr()

        # Create mask for upper triangle
        mask = np.triu(np.ones_like(corr_matrix, dtype=bool))

        # Generate heatmap
        sns.heatmap(corr_matrix, mask=mask, annot=True, fmt='.2f',
                   cmap='coolwarm', center=0, square=True, linewidths=1,
                   cbar_kws={"shrink": 0.8})

        plt.title(title, fontsize=14, fontweight='bold')
        plt.tight_layout()
        plt.savefig(self.output_path, dpi=150, bbox_inches='tight')
        plt.close()
        return True

    def create_time_series_analysis(self, df, date_col, value_cols, title="Time Series Analysis"):
        """Create advanced time series visualization with trends"""
        if PLOTLY_AVAILABLE:
            fig = go.Figure()

            for col in value_cols:
                fig.add_trace(go.Scatter(
                    x=df[date_col], y=df[col],
                    mode='lines+markers',
                    name=col,
                    line=dict(width=2),
                    marker=dict(size=4)
                ))

            # Add range slider
            fig.update_xaxes(rangeslider_visible=True)

            fig.update_layout(
                title=title,
                xaxis_title="Date",
                yaxis_title="Value",
                hovermode='x unified',
                template='plotly_white',
                height=600
            )

            fig.write_image(str(self.output_path))
            return True
        else:
            # Matplotlib fallback
            fig, ax = plt.subplots(figsize=(14, 8))

            for col in value_cols:
                ax.plot(df[date_col], df[col], marker='o', markersize=3,
                       label=col, linewidth=2)

            ax.set_xlabel('Date', fontsize=12)
            ax.set_ylabel('Value', fontsize=12)
            ax.set_title(title, fontsize=14, fontweight='bold')
            ax.legend(loc='best')
            ax.grid(True, alpha=0.3)

            # Rotate x-axis labels for better readability
            plt.xticks(rotation=45)

            plt.tight_layout()
            plt.savefig(self.output_path, dpi=150, bbox_inches='tight')
            plt.close()
            return True

    def create_distribution_analysis(self, data, title="Distribution Analysis"):
        """Create distribution plots with statistical annotations"""
        fig, axes = plt.subplots(2, 2, figsize=(14, 10))

        # Histogram with KDE
        axes[0, 0].hist(data, bins=30, density=True, alpha=0.7, color='blue', edgecolor='black')
        if SKLEARN_AVAILABLE:
            from scipy.stats import gaussian_kde
            kde = gaussian_kde(data)
            x_range = np.linspace(data.min(), data.max(), 100)
            axes[0, 0].plot(x_range, kde(x_range), 'r-', linewidth=2, label='KDE')
        axes[0, 0].set_title('Histogram with KDE')
        axes[0, 0].legend()

        # Q-Q plot
        if SKLEARN_AVAILABLE:
            stats.probplot(data, dist="norm", plot=axes[0, 1])
            axes[0, 1].set_title('Q-Q Plot')

        # Box plot
        axes[1, 0].boxplot(data, vert=False, patch_artist=True,
                          boxprops=dict(facecolor='lightblue'))
        axes[1, 0].set_title('Box Plot')

        # Violin plot
        parts = axes[1, 1].violinplot(data, vert=False, showmeans=True, showmedians=True)
        axes[1, 1].set_title('Violin Plot')

        fig.suptitle(title, fontsize=16, fontweight='bold')
        plt.tight_layout()
        plt.savefig(self.output_path, dpi=150, bbox_inches='tight')
        plt.close()
        return True

    def create_3d_visualization(self, x, y, z, title="3D Visualization"):
        """Create 3D scatter plot"""
        if PLOTLY_AVAILABLE:
            fig = go.Figure(data=[go.Scatter3d(
                x=x, y=y, z=z,
                mode='markers',
                marker=dict(
                    size=5,
                    color=z,
                    colorscale='Viridis',
                    showscale=True
                )
            )])

            fig.update_layout(
                title=title,
                scene=dict(
                    xaxis_title='X',
                    yaxis_title='Y',
                    zaxis_title='Z'
                ),
                height=700
            )

            fig.write_image(str(self.output_path))
            return True
        else:
            # Matplotlib 3D
            from mpl_toolkits.mplot3d import Axes3D

            fig = plt.figure(figsize=(12, 9))
            ax = fig.add_subplot(111, projection='3d')

            scatter = ax.scatter(x, y, z, c=z, cmap='viridis', s=50)

            ax.set_xlabel('X')
            ax.set_ylabel('Y')
            ax.set_zlabel('Z')
            ax.set_title(title, fontsize=14, fontweight='bold')

            plt.colorbar(scatter)
            plt.savefig(self.output_path, dpi=150, bbox_inches='tight')
            plt.close()
            return True

    def create_executive_summary(self, metrics_dict, title="Executive Summary"):
        """Create a clean executive summary visualization"""
        fig, ax = plt.subplots(figsize=(12, 8))
        ax.axis('tight')
        ax.axis('off')

        # Convert metrics to table format
        table_data = [[k, str(v)] for k, v in metrics_dict.items()]

        table = ax.table(cellText=table_data,
                        colLabels=['Metric', 'Value'],
                        cellLoc='left',
                        loc='center',
                        colWidths=[0.5, 0.5])

        table.auto_set_font_size(False)
        table.set_fontsize(11)
        table.scale(1, 2)

        # Style the table
        for i in range(len(table_data) + 1):
            if i == 0:
                for j in range(2):
                    table[(i, j)].set_facecolor('#4CAF50')
                    table[(i, j)].set_text_props(weight='bold', color='white')
            else:
                for j in range(2):
                    if i % 2 == 0:
                        table[(i, j)].set_facecolor('#f0f0f0')

        plt.title(title, fontsize=16, fontweight='bold', pad=20)
        plt.savefig(self.output_path, dpi=150, bbox_inches='tight')
        plt.close()
        return True

def get_engine_capabilities():
    """Return available visualization capabilities"""
    capabilities = {
        'basic': ['matplotlib', 'seaborn', 'numpy', 'pandas'],
        'advanced': [],
        'features': [
            'financial_dashboard',
            'correlation_heatmap',
            'time_series_analysis',
            'distribution_analysis',
            'executive_summary'
        ]
    }

    if PLOTLY_AVAILABLE:
        capabilities['advanced'].append('plotly')
        capabilities['features'].append('3d_visualization')
        capabilities['features'].append('interactive_charts')

    if ALTAIR_AVAILABLE:
        capabilities['advanced'].append('altair')
        capabilities['features'].append('declarative_visualization')

    if SKLEARN_AVAILABLE:
        capabilities['advanced'].extend(['scipy', 'scikit-learn'])
        capabilities['features'].extend(['statistical_analysis', 'ml_visualizations'])

    return capabilities

if __name__ == "__main__":
    # Can be run standalone for testing
    print("Chart Engine Capabilities:")
    print(json.dumps(get_engine_capabilities(), indent=2))