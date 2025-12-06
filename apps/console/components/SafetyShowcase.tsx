"use client";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, UserCheck, FileText, Eye, Lock } from "lucide-react";

const safetyFeatures = [
    {
        icon: Shield,
        title: "Constitutional AI",
        description: "Embedded ethical principles that agents self-enforce. No manual oversight needed for routine decisions.",
        status: "Active",
        color: "cyan"
    },
    {
        icon: AlertTriangle,
        title: "Kill Switch",
        description: "Emergency shutdown mechanism. Soft block, hard stop, or full revocation within one heartbeat.",
        status: "Active",
        color: "red"
    },
    {
        icon: UserCheck,
        title: "Human-in-the-Loop",
        description: "Approval gates for high-risk actions. Configurable risk levels with timeout protection.",
        status: "Active",
        color: "violet"
    },
    {
        icon: FileText,
        title: "Audit Trail",
        description: "Immutable log of every decision. Full provenance for compliance and debugging.",
        status: "Active",
        color: "amber"
    },
    {
        icon: Eye,
        title: "Anomaly Detection",
        description: "ML-based detection of unusual patterns. Automatic throttling on suspicious behavior.",
        status: "Beta",
        color: "blue"
    },
    {
        icon: Lock,
        title: "Capability Security",
        description: "Agents declare permissions. Fine-grained access control at the capability level.",
        status: "Active",
        color: "green"
    },
];

const colorClasses = {
    cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
    violet: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    green: "bg-green-500/10 text-green-400 border-green-500/20",
};

export default function SafetyShowcase() {
    return (
        <section className="relative py-24 overflow-hidden bg-gradient-to-b from-black via-neutral-950 to-black">
            {/* Background Effects */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(239,68,68,0.1),transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(6,182,212,0.1),transparent_50%)]" />

            <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    viewport={{ once: true }}
                    className="text-center mb-16"
                >
                    <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 mb-4">
                        <Shield className="w-4 h-4" />
                        Safety First
                    </span>
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        Built-in Guardrails
                    </h2>
                    <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
                        Emergent intelligence requires robust safety. Every layer is designed with
                        protection mechanisms — from kill switches to constitutional principles.
                    </p>
                </motion.div>

                {/* Safety Grid */}
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {safetyFeatures.map((feature, i) => (
                        <motion.div
                            key={feature.title}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4, delay: i * 0.1 }}
                            viewport={{ once: true }}
                            className="group relative p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer"
                        >
                            {/* Status Badge */}
                            <div className="absolute top-4 right-4">
                                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${feature.status === "Active"
                                        ? "bg-green-500/10 text-green-400 border border-green-500/20"
                                        : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                    }`}>
                                    {feature.status}
                                </span>
                            </div>

                            {/* Icon */}
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 border ${colorClasses[feature.color as keyof typeof colorClasses]}`}>
                                <feature.icon className="w-6 h-6" />
                            </div>

                            {/* Content */}
                            <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                            <p className="text-sm text-neutral-400 leading-relaxed">{feature.description}</p>
                        </motion.div>
                    ))}
                </div>

                {/* Alert Banner */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.4 }}
                    viewport={{ once: true }}
                    className="mt-12 p-6 rounded-2xl bg-red-500/5 border border-red-500/20"
                >
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-red-400" />
                        </div>
                        <div>
                            <h4 className="text-lg font-semibold text-white mb-1">Safety is Non-Negotiable</h4>
                            <p className="text-neutral-400">
                                All production deployments require human-in-the-loop gates for high-risk actions.
                                Agents without proper safety configuration cannot access sensitive capabilities.
                            </p>
                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}
