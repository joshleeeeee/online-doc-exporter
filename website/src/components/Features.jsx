
import React from 'react';
import { motion } from 'framer-motion';
import { Download, Layers, ShieldCheck, Image, Code2, Zap, Layout, ListChecks, ArrowRightLeft, Database } from 'lucide-react';
import { content } from '../data/content';

const iconMap = {
    0: <Zap size={24} className="text-yellow-400" />,
    1: <Layers size={24} className="text-blue-400" />,
    2: <Image size={24} className="text-purple-400" />,
    3: <ListChecks size={24} className="text-green-400" />,
    4: <ArrowRightLeft size={24} className="text-indigo-400" />,
    5: <Code2 size={24} className="text-emerald-400" />,
    6: <ShieldCheck size={24} className="text-red-400" />,
    7: <Download size={24} className="text-cyan-400" />
};

const colorMap = {
    0: "bg-yellow-500/10 border-yellow-500/20",
    1: "bg-blue-500/10 border-blue-500/20",
    2: "bg-purple-500/10 border-purple-500/20",
    3: "bg-green-500/10 border-green-500/20",
    4: "bg-indigo-500/10 border-indigo-500/20",
    5: "bg-emerald-500/10 border-emerald-500/20",
    6: "bg-red-500/10 border-red-500/20",
    7: "bg-cyan-500/10 border-cyan-500/20"
};

const Features = ({ lang }) => {
    const t = content[lang].features;

    return (
        <section id="features" className="py-24 bg-slate-900/50 relative overflow-hidden">
            {/* Background Elements */}
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-slate-700 to-transparent opacity-50"></div>

            <div className="container mx-auto px-4">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-16"
                >
                    <h2 className="text-3xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 mb-4">
                        {t.highlight}
                    </h2>
                    <p className="text-slate-400 max-w-2xl mx-auto text-lg">
                        {t.subHighlight}
                    </p>
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {t.list.map((feature, index) => (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: index * 0.1 }}
                            whileHover={{ y: -5 }}
                            className={`p-6 rounded-2xl border bg-slate-800/20 backdrop-blur-sm transition-all duration-300 hover:shadow-xl group cursor-pointer ${colorMap[index % 8]}`}
                        >
                            <div className="mb-4 p-3 rounded-lg bg-slate-900 w-fit group-hover:scale-110 transition-transform">
                                {iconMap[index % 8]}
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">{feature.title}</h3>
                            <p className="text-slate-400 leading-relaxed text-sm">
                                {feature.description}
                            </p>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default Features;
