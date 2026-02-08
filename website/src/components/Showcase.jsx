
import React from 'react';
import { motion } from 'framer-motion';
import { content } from '../data/content';

const Showcase = ({ lang }) => {
    const t = content[lang].showcase;
    return (
        <section id="showcase" className="py-24 relative overflow-hidden">
            <div className="container mx-auto px-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    className="text-center mb-20"
                >
                    <h2 className="text-3xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500 mb-6">
                        {t.title}
                    </h2>
                    <p className="text-slate-400 max-w-2xl mx-auto">
                        {t.subtitle}
                    </p>
                </motion.div>

                {/* Step 1 */}
                <div className="grid md:grid-cols-2 gap-12 items-center mb-32">
                    <motion.div
                        initial={{ opacity: 0, x: -50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        className="order-2 md:order-1 relative group max-w-md mx-auto"
                    >
                        <div className="absolute -inset-2 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-2xl blur opacity-25 group-hover:opacity-40 transition-opacity"></div>
                        <img
                            src="/online-doc-exporter/images/preview-batch.png"
                            alt="Batch Export"
                            className="relative rounded-xl border border-slate-700 shadow-2xl w-full rotate-1 group-hover:rotate-0 transition-transform duration-500"
                        />
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0, x: 50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        className="order-1 md:order-2 space-y-6"
                    >
                        <h3 className="text-2xl font-bold text-white flex items-center gap-3">
                            <span className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold">1</span>
                            {t.step1.title}
                        </h3>
                        <p className="text-slate-400 text-lg leading-relaxed">
                            {t.step1.description}
                        </p>
                        <ul className="space-y-3 text-slate-300">
                            <li className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                                {t.step1.point1}
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                                {t.step1.point2}
                            </li>
                        </ul>
                    </motion.div>
                </div>

                {/* Step 2 */}
                <div className="grid md:grid-cols-2 gap-12 items-center">
                    <motion.div
                        initial={{ opacity: 0, x: -50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        className="space-y-6"
                    >
                        <h3 className="text-2xl font-bold text-white flex items-center gap-3">
                            <span className="w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-bold">2</span>
                            {t.step2.title}
                        </h3>
                        <p className="text-slate-400 text-lg leading-relaxed">
                            {t.step2.description}
                        </p>
                        <ul className="space-y-3 text-slate-300">
                            <li className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                                {t.step2.point1}
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                                {t.step2.point2}
                            </li>
                        </ul>
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0, x: 50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        className="relative group max-w-md mx-auto"
                    >
                        <div className="absolute -inset-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl blur opacity-25 group-hover:opacity-40 transition-opacity"></div>
                        <img
                            src="/online-doc-exporter/images/preview-download.png"
                            alt="Download Center"
                            className="relative rounded-xl border border-slate-700 shadow-2xl w-full -rotate-1 group-hover:rotate-0 transition-transform duration-500"
                        />
                    </motion.div>
                </div>

                {/* Step 3 */}
                <div className="grid md:grid-cols-2 gap-12 items-center mt-32">
                    <motion.div
                        initial={{ opacity: 0, x: -50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        className="order-2 md:order-1 relative group max-w-md mx-auto"
                    >
                        <div className="absolute -inset-2 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl blur opacity-25 group-hover:opacity-40 transition-opacity"></div>
                        <img
                            src="/online-doc-exporter/images/preview-settings.png"
                            alt="Advanced Settings"
                            className="relative rounded-xl border border-slate-700 shadow-2xl w-full rotate-1 group-hover:rotate-0 transition-transform duration-500"
                        />
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0, x: 50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        className="order-1 md:order-2 space-y-6"
                    >
                        <h3 className="text-2xl font-bold text-white flex items-center gap-3">
                            <span className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm font-bold">3</span>
                            {t.step3.title}
                        </h3>
                        <p className="text-slate-400 text-lg leading-relaxed">
                            {t.step3.description}
                        </p>
                        <ul className="space-y-3 text-slate-300">
                            <li className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                {t.step3.point1}
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                {t.step3.point2}
                            </li>
                        </ul>
                    </motion.div>
                </div>
            </div>
        </section>
    );
};

export default Showcase;
