#!/usr/bin/env python3
# ons_dashboard.py — UK Unemployment Streamlit App

import streamlit as st
import pandas as pd
from datetime import datetime

st.set_page_config(
    page_title="UK Unemployment Dashboard",
    layout="wide"
)

@st.cache_data(ttl=3600)
def load_data():
    # Attempt real-time ONS Labour Market data; fallback to sample data if forbidden
    import urllib.error
    url = (
        "https://api.ons.gov.uk/timeseriestool?"
        "dataset=employmentandemployeetypes/summaryoflabourmarketstatistics&frequency=quarterly"
        "&measures=unemployment_rate,unemployment_count,payrolled_employees"
    )
    try:
        df = pd.read_csv(url, parse_dates=["Quarter"] )
        df.rename(columns={
            "Quarter": "date",
            "unemployment_rate": "rate",
            "unemployment_count": "count",
            "payrolled_employees": "payrolled"
        }, inplace=True)
        df['year'] = df['date'].dt.year
    except urllib.error.HTTPError as e:
        st.warning(f"Live ONS data fetch failed ({e.code}); using sample data.")
        # Sample static data (Q1 2020 to Q4 2025)
        data = {
            'date': pd.to_datetime([
                '2020-01-01','2020-04-01','2020-07-01','2020-10-01',
                '2021-01-01','2021-04-01','2021-07-01','2021-10-01',
                '2022-01-01','2022-04-01','2022-07-01','2022-10-01',
                '2023-01-01','2023-04-01','2023-07-01','2023-10-01',
                '2024-01-01','2024-04-01','2024-07-01','2024-10-01',
                '2025-01-01','2025-04-01','2025-07-01','2025-10-01'
            ]),
            'rate': [4.0,5.2,4.8,5.2,5.0,4.8,4.5,4.1,3.8,3.8,3.7,3.7,3.8,4.0,4.2,4.0,4.0,4.2,4.3,4.4,4.3,4.2,4.3,4.4],
            'count': [1600,2000,1900,2100,2050,2000,1850,1700,1600,1580,1550,1520,1540,1580,1620,1600,1620,1650,1680,1710,1720,1740,1760,1840],
            'payrolled': [27000,26500,26000,25500,25800,26200,26500,26900,27300,27500,27700,27900,28000,28200,28500,28700,28900,29100,29200,29300,29500,29700,29900,30200]
        }
        df = pd.DataFrame(data)
        df['year'] = df['date'].dt.year
    return df

# Load data
df = load_data()

# Title and timestamp
st.title("📊 UK Unemployment Dashboard")
st.sidebar.header("Filters")

# KPI row
col1, col2, col3, col4 = st.columns(4)
latest = df.iloc[-1]
prev_year = df[df['year'] == latest['year']-1].iloc[-1]
col1.metric("Unemployment Rate", f"{latest['rate']:.1f}%")
col2.metric("Unemployed (000s)", f"{latest['count']:,}")
col3.metric("Change YoY", f"{latest['rate']-prev_year['rate']:+.1f}%")
col4.metric("Last Updated", latest['date'].strftime('%b %Y'))

st.markdown("---")

# Time-series chart
st.subheader("Unemployment Rate (Quarterly)")
st.line_chart(df.set_index('date')['rate'], use_container_width=True)

st.markdown("---")

# Top sectors placeholder
st.subheader("⚠️ Sector breakdown coming soon")
st.info("Detailed sector/job-loss data will integrate here.")

st.markdown("---")

# Regional placeholder
st.subheader("⚠️ Regional breakdown coming soon")
st.info("Regional unemployment chart will appear here.")

st.markdown("---")

st.sidebar.write(f"*Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*")
