import React from 'react';
import { Play, Pause } from 'lucide-react';

interface ControlBarProps {
    isPlaying: boolean;
    onTogglePlay: () => void;
    speed: number;
    setSpeed: (s: number) => void;
    progress: number;
    onSeek: (val: number) => void;
    max: number;
}

const ControlBar: React.FC<ControlBarProps> = ({ isPlaying, onTogglePlay, speed, setSpeed, progress, onSeek, max }) => {
    return (
        <div className="glass-panel p-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
                <button 
                    onClick={onTogglePlay}
                    className="p-2 bg-white text-black border border-novus-border rounded shadow-sm hover:bg-gray-50 transition-colors"
                >
                    {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </button>
                
                <div className="flex items-center space-x-2 bg-gray-100 rounded p-1 border border-novus-border">
                    {[0.5, 1, 2, 5].map(s => (
                        <button
                            key={s}
                            onClick={() => setSpeed(s)}
                            className={`px-3 py-1 text-xs rounded transition-all ${speed === s ? 'bg-black text-white' : 'text-gray-500 hover:text-black'}`}
                        >
                            {s}x
                        </button>
                    ))}
                </div>
            </div>
            
            <div className="flex-1 mx-8">
                <input
                    type="range"
                    min="0"
                    max={max}
                    value={progress}
                    onChange={(e) => onSeek(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black"
                />
            </div>
            
            <div className="text-mono text-sm text-gray-500">
                FRAME: {progress} / {max}
            </div>
        </div>
    );
};

export default ControlBar;
