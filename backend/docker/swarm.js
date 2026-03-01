const { hostManager } = require('./client');

async function isSwarmMode(dockerClient) {
    try {
        const info = await dockerClient.info();
        return info.Swarm?.LocalNodeState === 'active';
    } catch (err) {
        return false;
    }
}

async function listSwarmServices(dockerClient) {
    try {
        const services = await dockerClient.listServices();
        return services.map(svc => ({
            id: svc.ID,
            name: svc.Spec.Name,
            replicas: svc.Spec.Mode?.Replicated?.Replicas,
            image: svc.Spec.TaskTemplate?.ContainerSpec?.Image,
            state: svc.UpdateStatus?.State || 'running',
        }));
    } catch (err) {
        return [];
    }
}

module.exports = { isSwarmMode, listSwarmServices };
