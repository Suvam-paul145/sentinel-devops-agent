const { hostManager } = require('./client');

async function restartContainer(compoundId) {
    try {
        const { hostId, containerId } = hostManager.parseId(compoundId);
        const hostData = hostManager.get(hostId);
        if (!hostData || !hostData.client) throw new Error(`Host disconnected: ${hostId}`);

        const container = hostData.client.getContainer(containerId);
        await container.restart({ t: 10 });
        return { action: 'restart', success: true, containerId: compoundId };
    } catch (error) {
        console.error(`Failed to restart container ${compoundId}:`, error);
        return { action: 'restart', success: false, containerId: compoundId, error: error.message };
    }
}

async function recreateContainer(compoundId) {
    try {
        const { hostId, containerId } = hostManager.parseId(compoundId);
        const hostData = hostManager.get(hostId);
        if (!hostData || !hostData.client) throw new Error(`Host disconnected: ${hostId}`);

        const container = hostData.client.getContainer(containerId);
        const info = await container.inspect();

        const networkingConfig = {
            EndpointsConfig: info.NetworkSettings.Networks
        };

        const newName = `${info.Name.replace('/', '')}-new`;
        const newContainer = await hostData.client.createContainer({
            Image: info.Config.Image,
            name: newName,
            ...info.Config,
            HostConfig: info.HostConfig,
            NetworkingConfig: networkingConfig
        });

        await newContainer.start();

        if (info.State.Running) {
            await container.stop();
        }
        await container.remove();

        await newContainer.rename({ name: info.Name.replace('/', '') });

        return { action: 'recreate', success: true, newId: `${hostId}:${newContainer.id}` };
    } catch (error) {
        console.error(`Failed to recreate container ${compoundId}:`, error);
        return { action: 'recreate', success: false, containerId: compoundId, error: error.message };
    }
}

async function scaleService(serviceName, replicas, hostId = 'local') {
    try {
        const hostData = hostManager.get(hostId); // Typically swarm is host specific
        if (!hostData || !hostData.client) throw new Error(`Host disconnected: ${hostId}`);

        const service = hostData.client.getService(serviceName);
        const info = await service.inspect();
        const version = info.Version.Index;

        const spec = { ...info.Spec };
        if (!spec.Mode) spec.Mode = {};
        if (!spec.Mode.Replicated) spec.Mode.Replicated = {};
        spec.Mode.Replicated.Replicas = parseInt(replicas, 10);

        await service.update({
            version: version,
            ...spec
        });
        return { action: 'scale', replicas, success: true };
    } catch (error) {
        console.error(`Failed to scale service ${serviceName}:`, error);
        return { action: 'scale', replicas, success: false, error: error.message };
    }
}

module.exports = { restartContainer, recreateContainer, scaleService };
