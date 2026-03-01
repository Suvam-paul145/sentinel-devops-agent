import { useState, useEffect } from 'react';
import axios from 'axios';
import { HostInfo } from '@/components/dashboard/HostSelector';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export function useHosts(options: { manual?: boolean } = {}) {
    const { manual } = options;
    const [hosts, setHosts] = useState<HostInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchHosts = async () => {
        try {
            const response = await axios.get(`${API_BASE}/api/hosts`);
            setHosts(response.data.hosts);
            setError(null);
        } catch (err: unknown) {
            console.error("Failed to fetch hosts:", err);
            const message = err instanceof Error ? err.message : "Failed to load hosts";
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHosts();

        let interval: NodeJS.Timeout;
        if (!manual) {
            // Poll hosts status every 10 seconds (less frequent than containers)
            interval = setInterval(fetchHosts, 10000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [manual]);

    return {
        hosts,
        loading,
        error,
        refetch: fetchHosts
    };
}
