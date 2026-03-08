const { docker } = require('./client');

async function restartContainer(containerId) {
    try {
        const container = docker.getContainer(containerId);
        await container.restart({ t: 10 });
        return { action: 'restart', success: true, containerId };
    } catch (error) {
        console.error(`Failed to restart container ${containerId}:`, error);
        return { action: 'restart', success: false, containerId, error: error.message };
    }
}

async function recreateContainer(containerId) {
    let backupContainer = null;
    let newContainer = null;
    let originalName = '';

    try {
        const container = docker.getContainer(containerId);
        const info = await container.inspect();
        originalName = info.Name.replace('/', '');

        const timestamp = Date.now();
        const backupName = `${originalName}_backup_${timestamp}`;
        const tempName = `${originalName}_new_${timestamp}`;

        console.log(`[HEALER] Starting safe recreation for ${originalName}`);

        // 1. Create new container with temporary name
        const networkingConfig = {
            EndpointsConfig: info.NetworkSettings.Networks
        };

        newContainer = await docker.createContainer({
            ...info.Config,
            name: tempName,
            HostConfig: info.HostConfig,
            NetworkingConfig: networkingConfig
        });

        // 2. Start new container
        await newContainer.start();
        console.log(`[HEALER] New container ${tempName} started.`);

        // 3. Rename old container to backup name
        // This frees up the original name
        await container.rename({ name: backupName });
        backupContainer = container;
        console.log(`[HEALER] Old container renamed to ${backupName}.`);

        try {
            // 4. Rename new container to original name
            await newContainer.rename({ name: originalName });
            console.log(`[HEALER] New container renamed to ${originalName}.`);
        } catch (renameError) {
            console.error(`[HEALER] Critical: Failed to rename new container to ${originalName}.`, renameError);
            console.error(`[HEALER] Original container is preserved as ${backupName}. Manual intervention required.`);
            throw new Error(`Rename failed: ${renameError.message}. Backup preserved as ${backupName}`);
        }

        // 5. Safely remove the backup (old) container
        if (info.State.Running) {
            try {
                await backupContainer.stop({ t: 10 });
            } catch (stopError) {
                console.warn(`[HEALER] Failed to stop backup container: ${stopError.message}`);
            }
        }
        await backupContainer.remove();
        console.log(`[HEALER] Backup container ${backupName} removed.`);

        return { action: 'recreate', success: true, newId: newContainer.id, name: originalName };
    } catch (error) {
        console.error(`Failed to recreate container ${containerId}:`, error);
        return { 
            action: 'recreate', 
            success: false, 
            containerId, 
            error: error.message,
            tip: error.message.includes('Backup preserved') ? 'Check Docker for backup container' : undefined
        };
    }
}

async function scaleService(serviceName, replicas) {
    try {
        const service = docker.getService(serviceName);
        const info = await service.inspect();
        const version = info.Version.Index;

        // Merge new replicas into existing spec
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
