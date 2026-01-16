export interface DashboardData {
    metadata: {
        x_pdf: number[];
        y_lags: number[];
        asset_names: string[];
        base_weights: number[];
        initial_capital: number;
    };
    returns: {
        dates: string[];
        assets: { [key: string]: number[] };
        covariances: number[][][]; // Ht matrices
        regime_probs: number[]; // High Volatility Regime Probability
        raw: number[][]; // [day][asset] returns
    };
    surfaces: number[][][];
}
