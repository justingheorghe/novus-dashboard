import React, { useMemo } from 'react';
import Plot from 'react-plotly.js';

interface SurfaceChartProps {
    zData: number[][];
    xData: number[];
    yData: number[];
    maxZ: number;
}

const SurfaceChart: React.FC<SurfaceChartProps> = ({ zData, xData, yData, maxZ }) => {
    
    const layout = useMemo(() => ({
        autosize: true,
        margin: { l: 0, r: 0, t: 0, b: 0 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        scene: {
            xaxis: { 
                title: { text: 'Returns' }, 
                showgrid: true, 
                gridcolor: '#E0E0E0', 
                zerolinecolor: '#CCC', 
                showticklabels: true,
                tickfont: { color: '#333', size: 10 },
                backgroundcolor: 'rgba(255,255,255,0)'
            },
            yaxis: { 
                title: { text: 'History (Days)' }, 
                showgrid: true, 
                gridcolor: '#E0E0E0', 
                showticklabels: false,
                backgroundcolor: 'rgba(255,255,255,0)'
            },
            zaxis: { 
                title: { text: 'Probability Density' }, 
                showgrid: true, 
                gridcolor: '#E0E0E0', 
                range: [0, maxZ], 
                showticklabels: false,
                backgroundcolor: 'rgba(255,255,255,0)'
            },
            camera: {
                eye: { x: 1.8, y: 0.1, z: 0.5 },
                center: { x: 0, y: 0, z: -0.2 }
            },
            aspectratio: { x: 1, y: 1, z: 0.4 }
        },
        showlegend: false,
    }), [maxZ]);

    const data = useMemo(() => ([{
        type: 'surface' as const,
        z: zData,
        x: xData,
        y: yData,
        colorscale: [
            [0, 'rgb(255,0,0)'],
            [0.2, 'rgb(255,136,0)'],
            [0.5, 'rgb(0,255,0)'],
            [1, 'rgb(0,136,255)']
        ] as any,
        cmin: 0,
        cmax: maxZ,
        showscale: false,
        lighting: {
            ambient: 0.4,
            diffuse: 0.5,
            roughness: 0.9,
            specular: 0.1,
            fresnel: 0.2
        }
    } as any]), [zData, xData, yData, maxZ]);

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

export default SurfaceChart;
