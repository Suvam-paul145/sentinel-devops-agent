"use client";

import { Service } from "@/lib/mockData";
import { ServiceCard } from "./ServiceCard";
import { motion } from "framer-motion";
import { usePredictions } from "@/hooks/usePredictions";

export function ServiceGrid({ services }: { services: Service[] }) {
    const predictionsMap = usePredictions();
    const predictions = Object.values(predictionsMap);

    const getPrediction = (service: Service) => {
        return predictions.find(p => {
            const name = (p.containerName || '').toLowerCase();
            const serviceId = service.id.toLowerCase();
            // Try to match generic service bits like "auth" or "payment" if strict match fails
            if (name.includes(serviceId)) return true;
            
            // Or try name without dashes/spaces
            const simpleServiceName = service.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (name.replace(/[^a-z0-9]/g, '').includes(simpleServiceName)) return true;

            return false;
        });
    };

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {services.map((service, index) => (
                <motion.div
                    key={service.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                >
                    <ServiceCard service={service} prediction={getPrediction(service)} />
                </motion.div>
            ))}
        </div>
    );
}
