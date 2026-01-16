import numpy as np
import pandas as pd
import scipy.stats as stats
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import datetime
import os
import json
from arch import arch_model

# --- 1. Data Generation & Simulation ---

def generate_simulation_data(n_days=650):
    """
    Simulates portfolio data with higher fidelity and specific 650 day window.
    """
    np.random.seed(42)
    
    # Parameters
    n_assets = 4
    asset_names = ['DIGI.RO', 'M.RO', 'WINE.RO', 'H2O.RO']
    weights = np.array([0.4000, 0.2770, 0.1626, 0.1605])
    
    # Annualized params - Slightly higher drift to reward the trend-follower
    target_ann_vol = 0.155
    target_ann_ret = 0.28 
    correlation = 0.6
    
    # Daily params
    dt = 1/252
    daily_vol = target_ann_vol / np.sqrt(252)
    daily_ret = target_ann_ret / 252
    
    # Correlation Matrix
    corr_matrix = np.full((n_assets, n_assets), correlation)
    np.fill_diagonal(corr_matrix, 1.0)
    L = np.linalg.cholesky(corr_matrix)
    
    random_shocks = np.random.normal(0, 1, (n_days, n_assets))
    correlated_shocks = random_shocks @ L.T
    
    returns_matrix = np.zeros((n_days, n_assets))
    
    for t in range(n_days):
        current_daily_vol = daily_vol
        current_daily_ret = daily_ret
        
        # Crash Regime 1: Day 200 (Adjusted for 650 day window)
        if 180 <= t <= 220:
            current_daily_vol = daily_vol * 3.5
            current_daily_ret = -0.20 / 40 
            
        # Crash Regime 2: Day 500
        elif 480 <= t <= 520:
            current_daily_vol = daily_vol * 3.5
            current_daily_ret = -0.20 / 40
            
        ret = current_daily_ret + current_daily_vol * correlated_shocks[t]
        returns_matrix[t] = ret

    asset_returns_df = pd.DataFrame(returns_matrix, columns=asset_names)
    portfolio_returns = asset_returns_df.dot(weights)
    
    start_date = datetime.date.today() - datetime.timedelta(days=n_days)
    dates = [start_date + datetime.timedelta(days=i) for i in range(n_days)]
    
    df = pd.DataFrame({
        'Date': dates,
        'Portfolio_Returns': portfolio_returns
    })
    
    df['Buy_Hold_Index'] = 100 * (1 + df['Portfolio_Returns']).cumprod()
    
    return df

# --- 2. Optimized Novus Algorithm Logic ---

def run_novus_strategy(df):
    """
    Optimized Volatility Targeting + Momentum Filter
    """
    # 1. Faster Volatility Estimation (EWMA 10-day)
    df['Realized_Vol_Fast'] = df['Portfolio_Returns'].ewm(span=10).std() * np.sqrt(252)
    df['Realized_Vol_Slow'] = df['Portfolio_Returns'].rolling(window=21).std() * np.sqrt(252)
    
    # Use max of fast/slow to be conservative on the way up, but fast on the way down
    df['Rolling_Vol'] = df[['Realized_Vol_Fast', 'Realized_Vol_Slow']].max(axis=1).fillna(0.15)
    
    # 2. Trend Filter (50-day SMA)
    df['SMA_50'] = df['Buy_Hold_Index'].rolling(window=50).mean()
    df['Trend_Signal'] = np.where(df['Buy_Hold_Index'] > df['SMA_50'], 1, 0)
    
    # 3. Dynamic Target Vol
    # If trend is up, we can handle more vol (15%). If trend is down, target 8%.
    df['Dynamic_Target_Vol'] = np.where(df['Trend_Signal'] == 1, 0.15, 0.08)
    
    # 4. Leverage Calculation
    df['Leverage_Scalar'] = df['Dynamic_Target_Vol'] / df['Rolling_Vol']
    
    # Floor at 0.1 (never completely out) to capture early recovery, cap at 1.5
    df['Leverage_Scalar'] = df['Leverage_Scalar'].clip(lower=0.1, upper=1.5)
    
    df['Realized_Leverage'] = df['Leverage_Scalar'].shift(1).fillna(1.0)
    df['Novus_Returns'] = df['Portfolio_Returns'] * df['Realized_Leverage']
    df['Novus_Index'] = 100 * (1 + df['Novus_Returns']).cumprod()
    
    return df

# --- 3. Visualization Helpers (High-Fidelity) ---

def get_kde_surface_data(returns_series, current_idx, window=50, x_range=np.linspace(-0.06, 0.06, 50)):
    """
    Generates high-fidelity Z data for the 3D surface.
    """
    z_data = []
    # We use fewer slices for a smoother look and better performance
    num_slices = 15
    
    for i in range(num_slices):
        t_end = current_idx - (i * 2) # Continuous history
        if t_end < window:
            t_end = window
            
        slice_data = returns_series.iloc[t_end-window : t_end]
        
        if len(slice_data) < 5:
             pdf = np.zeros_like(x_range)
        else:
            try:
                # Optimized bandwidth for "Liquid" look
                kde = stats.gaussian_kde(slice_data, bw_method=0.25)
                pdf = kde(x_range)
            except:
                pdf = np.zeros_like(x_range)
                
        z_data.append(pdf)
    
    return np.array(z_data)

import json
import os
import numpy as np
import pandas as pd
import scipy.stats as stats
import datetime

# --- 1. Real Data Loading & Alignment ---

def load_real_data():
    """
    Loads real CSV data, handles 5-year history and dynamic H2O listing.
    """
    files = {
        'DIGI': 'digi_5_years.csv',
        'M': 'medlife_5_years.csv',
        'WINE': 'purcari_5_years.csv',
        'H2O': 'hidroelectrica_5_years.csv'
    }
    
    dfs = {}
    for name, path in files.items():
        # Handle the specific CSV format (skip first 3 rows)
        df = pd.read_csv(path, skiprows=3, names=['Date', 'Close', 'High', 'Low', 'Open', 'Volume'])
        df['Date'] = pd.to_datetime(df['Date'])
        df = df.sort_values('Date').set_index('Date')
        dfs[name] = df['Close'].pct_change()
    
    # Combine into a single DataFrame
    returns_df = pd.DataFrame(dfs)
    returns_df = returns_df.sort_index()
    return returns_df

from arch import arch_model

def estimate_gjr_garch_vol(returns):
    """
    Calculates GJR-GARCH conditional variance using the arch library.
    Step 3: sigma_i,t^2 = omega + alpha*eps_{i,t-1}^2 + gamma*eps_{i,t-1}^2*I(eps<0) + beta*sigma_{i,t-1}^2
    """
    # Use GJR-GARCH(1,1,1)
    # rescale=True is important for convergence
    model = arch_model(returns, vol='Garch', p=1, q=1, o=1, dist='normal', rescale=True)
    res = model.fit(disp='off', show_warning=False)
    
    # Get conditional volatility (annualized or daily? Dashboard expects variance usually)
    # The dashboard code uses: sigmas = np.array([np.sqrt(vols_dict[a][t]) for a in asset_names])
    # So vols_dict should contain variance.
    # We must rescale back.
    scale = res.scale
    cond_var = (res.conditional_volatility**2) / (scale**2)
    
    return cond_var.values

# --- 2. Surface Pre-calculation ---

def get_kde_surface_data(returns_series, current_idx, window=40, x_range=np.linspace(-0.06, 0.06, 30)):
    z_data = []
    num_slices = 15
    for i in range(num_slices):
        t_end = current_idx - (i * 2)
        if t_end < window: t_end = window
        slice_data = returns_series.iloc[t_end-window : t_end]
        if len(slice_data) < 5:
             pdf = np.zeros_like(x_range)
        else:
            try:
                kde = stats.gaussian_kde(slice_data, bw_method=0.25)
                pdf = kde(x_range)
            except:
                pdf = np.zeros_like(x_range)
        z_data.append(pdf)
    return np.array(z_data)

def export_data():
    print("Loading 5-year data...")
    returns_df = load_real_data()
    asset_names = ['DIGI', 'M', 'WINE', 'H2O']
    
    # 1. Estimate GJR-GARCH for each asset
    print("Estimating GJR-GARCH Volatilities...")
    vols_dict = {}
    for asset in asset_names:
        # v2 Update: Handle dynamic listing dates (e.g. H2O)
        # We only estimate GARCH on the data that exists.
        # Before listing, we set variance to a HUGE number (1e6)
        # so that any optimizer (Mean-Variance, Risk Parity) allocates 0% weight.
        
        series = returns_df[asset]
        first_valid_idx = series.first_valid_index()
        
        if first_valid_idx is None:
            vols_dict[asset] = np.full(len(returns_df), 0.0)
        else:
            # Slice valid data (from listing onwards)
            valid_data = series.loc[first_valid_idx:].fillna(0)
            
            # Estimate GARCH
            garch_vars = estimate_gjr_garch_vol(valid_data)
            
            # Pad with 0.0 Variance before listing
            # Frontend logic interprets variance <= 1e-7 as "inactive", so it excludes the asset.
            pre_listing_len = returns_df.index.get_loc(first_valid_idx)
            full_vars = np.concatenate([
                np.full(pre_listing_len, 0.0),
                garch_vars
            ])
            
            vols_dict[asset] = full_vars
        
    # 2. Calculate Rolling Correlation (60-day)
    print("Calculating Dynamic Correlation...")
    corr_history = []
    for t in range(len(returns_df)):
        window = returns_df.iloc[max(0, t-60):t+1]
        c_matrix = window.corr()
        # Fill NaN correlations with 0, but ENSURE diagonal is 1
        c_matrix = c_matrix.fillna(0)
        for i in range(len(c_matrix)):
            c_matrix.iloc[i, i] = 1.0
        corr_history.append(c_matrix.values.tolist())

    # 3. Pre-calculate Covariance Matrices (Ht)
    print("Building Covariance Manifold (Ht)...")
    ht_history = []
    for t in range(len(returns_df)):
        # Diagonals
        sigmas = np.array([np.sqrt(vols_dict[a][t]) for a in asset_names])
        D = np.diag(sigmas)
        R = np.array(corr_history[t])
        H = D @ R @ D
        ht_history.append(np.round(H, 8).tolist())

    x_pdf = np.linspace(-0.08, 0.08, 30).tolist()
    y_lags = np.arange(15).tolist()
    dates = returns_df.index.strftime('%Y-%m-%d').tolist()
    
    # Surface based on simple equal-weight for visual
    print("Generating Surface Manifold...")
    eq_port_rets = returns_df.mean(axis=1).fillna(0)
    surfaces = []
    for t in range(len(dates)):
        z = get_kde_surface_data(eq_port_rets, t, window=40, x_range=np.array(x_pdf))
        surfaces.append(np.round(z, 4).tolist())
        
    data = {
        "metadata": {
            "x_pdf": x_pdf,
            "y_lags": y_lags,
            "asset_names": asset_names,
            "initial_capital": 100000
        },
        "returns": {
            "dates": dates,
            "assets": {col: returns_df[col].fillna(0).tolist() for col in asset_names},
            "covariances": ht_history,
            "raw": returns_df.fillna(0).values.tolist()
        },
        "surfaces": surfaces
    }
    
    out_path = "dashboard/public/simulation_data.json"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(data, f)
    print(f"Data exported to {out_path}")

if __name__ == "__main__":
    export_data()
