"use client";

import { useEffect, useState, useCallback } from "react";
import { useWebSocket } from "./useWebSocket";

export type Prediction = {
    containerId: string;
    containerName: string;
    failureProbability: number;
    trend: 'rising' | 'stable' | 'falling';
    reasons: string[];
    aiReasoning: string | null;
    recommendation: 'scale-out' | 'monitor';
    metrics: {
        cpuAvg: number;
        memAvg: number;
        cpuTrend: string;
        memTrend: string;
        cpuVelocity: number;
        memVelocity: number;
        samples: number;
    };
    evaluatedAt: string;
};

export function usePredictions() {
    const [predictions, setPredictions] = useState<Prediction[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastEvaluated, setLastEvaluated] = useState<string | null>(null);

    const fetchPredictions = useCallback(async () => {
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
            const res = await fetch(`${apiUrl}/predictions`);
            const data = await res.json();
            if (data.predictions) {
                setPredictions(data.predictions);
                setLastEvaluated(data.evaluatedAt);
            }
        } catch (e) {
            console.error("Failed to fetch predictions:", e);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchPredictions();
    }, [fetchPredictions]);

    // Listen for WebSocket updates
    const { lastMessage } = useWebSocket();

    useEffect(() => {
        if (!lastMessage) return;

        if (lastMessage.type === 'SCALE_PREDICTION') {
            const data = lastMessage.data as {
                predictions: Prediction[];
                evaluatedAt: string;
            };
            if (data.predictions) {
                setPredictions(data.predictions);
                setLastEvaluated(data.evaluatedAt);
            }
        }
    }, [lastMessage]);

    // Auto-refresh every 30 seconds
    useEffect(() => {
        const interval = setInterval(fetchPredictions, 30000);
        return () => clearInterval(interval);
    }, [fetchPredictions]);

    return { predictions, loading, lastEvaluated };
}
