import React from 'react';
import { motion } from 'framer-motion';

interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
}

export const GlowButton: React.FC<GlowButtonProps> = ({ children, className, ...props }) => {
    return (
        <div className="relative group inline-block">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-accent to-purple-600 rounded-lg blur opacity-30 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
            <button
                className={`relative px-8 py-4 bg-black rounded-lg leading-none flex items-center divide-x divide-gray-600 ${className}`}
                {...props}
            >
                <span className="flex items-center space-x-5">
                    <span className="text-gray-100 font-mono tracking-widest text-sm uppercase group-hover:text-white transition-colors">
                        {children}
                    </span>
                </span>
            </button>
        </div>
    );
};
