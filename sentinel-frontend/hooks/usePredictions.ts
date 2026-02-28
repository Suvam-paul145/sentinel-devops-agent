import { useState, useEffect } from 'react';
import { useWebSocketContext } from '@/lib/WebSocketContext';
import { Prediction } from '@/components/dashboard/PredictionBadge';

export function usePredictions() {
    const { lastMessage } = useWebSocketContext();
    const [predictions, setPredictions] = useState<Record<string, Prediction>>({});

    useEffect(() => {
        if (!lastMessage) return;
        
        if (lastMessage.type === 'PREDICTION') {
            const data = lastMessage.data as unknown as Prediction;
            setPredictions(prev => ({
                ...prev,
                [data.containerId]: data
            }));
        }
    }, [lastMessage]);

    return predictions;
}
