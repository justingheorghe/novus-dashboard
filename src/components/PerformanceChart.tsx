import React, { useMemo } from 'react';
import Plot from 'react-plotly.js';

interface PerformanceChartProps {
    dates: string[];
    buyHold: number[];
    novus: number[];
    currentIndex: number;
}

const PerformanceChart: React.FC<PerformanceChartProps> = ({ dates, buyHold, novus, currentIndex }) => {
    
    // Slice data
    const slicedDates = dates.slice(0, currentIndex + 1);
    const slicedBH = buyHold.slice(0, currentIndex + 1);
    const slicedNovus = novus.slice(0, currentIndex + 1);
    
    // Calculate Y range static for stability
    const maxY = Math.max(Math.max(...buyHold), Math.max(...novus)) * 1.1;
    const minY = Math.min(Math.min(...buyHold), Math.min(...novus)) * 0.9;

    const layout = useMemo(() => ({
        autosize: true,
        margin: { l: 30, r: 10, t: 10, b: 30 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        xaxis: { 
            gridcolor: '#E0E0E0', 
            zeroline: false,
            color: '#333',
            title: { text: 'Date' }
        },
        yaxis: { 
            gridcolor: '#E0E0E0', 
            range: [minY, maxY],
            color: '#333',
            title: { text: 'Equity Value ($)' },
            tickformat: '$,.0f'
        },
        showlegend: true, 
        legend: {
            x: 0,
            y: 1,
            font: { color: '#000' },
            bgcolor: 'rgba(255,255,255,0.5)'
        }
    }), [minY, maxY]);

    const data = useMemo(() => ([
        {
            x: slicedDates,
            y: slicedBH,
            type: 'scatter' as const,
            mode: 'lines' as const,
            line: { color: '#ff3333', width: 2 },
            name: 'Buy & Hold'
        },
        {
            x: slicedDates,
            y: slicedNovus,
            type: 'scatter' as const,
            mode: 'lines' as const,
            line: { color: '#00ff00', width: 3 },
            name: 'Novus Algo'
        }
    ]), [slicedDates, slicedBH, slicedNovus]);

    return (
        <div className="w-full h-full">
            <Plot
                data={data}
                layout={layout}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', height: '100%' }}
            />
        </div>
    );
};

export default PerformanceChart;
