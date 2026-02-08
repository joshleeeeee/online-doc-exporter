
import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Download, Zap } from 'lucide-react';
import { content } from '../data/content';

const Hero = ({ lang }) => {
    const t = content[lang].hero;

    return (
        <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
            <div className="container mx-auto px-4 text-center">
                {/* Badge */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/50 border border-slate-700 text-indigo-400 text-sm mb-6"
                >
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                    {t.badge}
                </motion.div>

                {/* Title */}
                <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400"
                >
                    {t.titleStart} <br className="hidden md:block" />
                    <span className="text-white">{t.titleEnd}</span>
                </motion.h1>

                {/* Description */}
                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed"
                >
                    {t.description}
                </motion.p>

                {/* Actions */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="flex flex-col sm:flex-row items-center justify-center gap-4"
                >
                    <a
                        href="https://github.com/joshleeeeee/online-doc-exporter/releases"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-semibold transition-all shadow-lg hover:shadow-indigo-500/25 flex items-center gap-2"
                    >
                        <Download size={20} />
                        <span>{t.addToChrome}</span>
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                        <div className="absolute inset-0 rounded-full ring-2 ring-white/20 group-hover:ring-white/40 transition-all" />
                    </a>
                    <a
                        href="#features"
                        className="px-8 py-4 bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white rounded-full font-medium transition-all"
                    >
                        {t.exploreFeatures}
                    </a>
                </motion.div>

                {/* Hero Image Showcase */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.5, type: "spring" }}
                    className="mt-12 relative max-w-md mx-auto"
                >
                    <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl blur opacity-20 animate-pulse"></div>
                    <div className="relative rounded-2xl overflow-hidden border border-slate-700 shadow-2xl bg-slate-900/50">
                        <img
                            src="/online-doc-exporter/images/preview-single.png"
                            alt="Extension Preview"
                            className="w-full h-auto block object-top hover:scale-105 transition-transform duration-700"
                        />

                        {/* Overlay Gradient */}
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/50 via-transparent to-transparent opacity-60"></div>
                    </div>

                    {/* Floating UI Elements */}
                    <motion.div
                        animate={{ y: [0, -10, 0] }}
                        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute -top-10 -right-10 md:right-10 w-24 h-24 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl rotate-12 blur-2xl opacity-40 z-[-1]"
                    />
                    <motion.div
                        animate={{ y: [0, 15, 0] }}
                        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                        className="absolute -bottom-10 -left-10 md:left-10 w-32 h-32 bg-cyan-500 rounded-full blur-3xl opacity-20 z-[-1]"
                    />
                </motion.div>
            </div>
        </section>
    );
};

export default Hero;
