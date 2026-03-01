import React from 'react';

export interface HostInfo {
    id: string;
    label: string;
    type: string;
    status: string;
    error?: string;
    containers?: number;
    containersRunning?: number;
    memoryLimit?: number;
    ncpu?: number;
    swarm?: boolean;
    aggregatedMetrics?: {
        cpu: string;
        memoryPercent: string;
    }
}

interface HostSelectorProps {
    hosts: HostInfo[];
    selectedHostId: string;
    onSelectHost: (id: string) => void;
    isLoading: boolean;
}

export const HostSelector: React.FC<HostSelectorProps> = ({ hosts, selectedHostId, onSelectHost, isLoading }) => {
    if (isLoading) {
        return <div className="animate-pulse bg-muted h-10 w-48 rounded-md"></div>;
    }

    return (
        <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Target Host:</label>
            <select
                value={selectedHostId}
                onChange={(e) => onSelectHost(e.target.value)}
                className="h-10 px-3 py-2 bg-background border border-input rounded-md text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 w-full md:w-64"
            >
                <option value="all">All Hosts</option>
                {hosts.map(host => (
                    <option key={host.id} value={host.id}>
                        {host.label} ({host.id}) {host.status !== 'connected' ? ' - Offline' : ''}
                    </option>
                ))}
            </select>
        </div>
    );
};
