import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MessageCircle, Lock, Shield, CheckCircle } from 'lucide-react';

const LoginPage: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            await login(username, password);
            navigate('/');
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Login failed. Please check your credentials.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex">
            {/* Left Panel - Unified Blue with Integrated Illustration */}
            <div className="hidden md:flex md:w-1/2 lg:w-3/5 bg-[#3B82F6] p-8 lg:p-12 flex-col justify-start items-center relative overflow-hidden">

                {/* Single Integrated Illustration - Matches background color */}
                <div className="relative z-10 w-full max-w-3xl mt-12">
                    <img
                        src="/login-panel.png"
                        alt="DigiEntry - Simply upload bills, we do the rest"
                        className="w-full h-auto object-contain"
                    />
                </div>
            </div>

            {/* Right Panel - Login Form (Colors Unchanged) */}
            <div className="flex-1 md:w-1/2 lg:w-2/5 bg-gradient-to-br from-gray-50 to-white flex items-center justify-center p-6 md:p-12">
                <div className="w-full max-w-md">
                    {/* Logo & Brand */}
                    <div className="text-center mb-8">
                        <div className="flex items-center justify-center gap-4 mb-4">
                            <img
                                src="/digientry-icon-large.png"
                                alt="DigiEntry Icon"
                                className="h-24 w-24 object-contain"
                            />
                            <div className="text-left">
                                <h1 className="text-4xl font-bold text-[#1a3a52] leading-tight">
                                    DigiEntry
                                </h1>
                                <p className="text-base text-gray-500 mt-1">
                                    Smart Digital Munim
                                </p>
                            </div>
                        </div>

                        {/* Trust Badge for Indian SMBs */}
                        <div className="flex items-center justify-center gap-4 text-xs text-gray-600 mt-4">
                            <div className="flex items-center gap-1">
                                <Shield className="w-4 h-4 text-green-600" />
                                <span className="font-medium">100% Secure</span>
                            </div>
                            <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                            <div className="flex items-center gap-1">
                                <span className="font-semibold">🇮🇳 Made in India</span>
                            </div>
                        </div>
                    </div>

                    {/* Login Card */}
                    <div className="bg-white rounded-2xl shadow-2xl p-8 border border-gray-100">
                        <h2 className="text-xl font-bold text-gray-800 mb-6 text-center">
                            Login to Your Account
                        </h2>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            {error && (
                                <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded-lg text-sm">
                                    <strong className="font-semibold">Error: </strong>{error}
                                </div>
                            )}

                            <div>
                                <label htmlFor="username" className="block text-sm font-semibold text-gray-700 mb-2">
                                    User ID
                                </label>
                                <input
                                    id="username"
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="Enter your User ID"
                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-gray-50 hover:bg-white text-base"
                                    required
                                    autoComplete="username"
                                />
                            </div>

                            <div>
                                <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
                                    Password
                                </label>
                                <input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Enter your password"
                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-gray-50 hover:bg-white text-base"
                                    required
                                    autoComplete="current-password"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3.5 px-4 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Signing in...
                                    </span>
                                ) : 'Login'}
                            </button>

                            {/* WhatsApp Alert Info */}
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2">
                                <MessageCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                                <div className="text-sm">
                                    <p className="font-semibold text-green-800">Get Daily WhatsApp Reports</p>
                                    <p className="text-green-700 text-xs mt-1">Income, expenses & stock alerts on WhatsApp</p>
                                </div>
                            </div>

                            <div className="text-center pt-2">
                                <span className="text-gray-600 text-sm">No account? </span>
                                <a href="#" className="text-blue-600 hover:text-blue-700 font-semibold hover:underline transition-all text-sm">
                                    Sign up free
                                </a>
                            </div>
                        </form>
                    </div>

                    {/* Trust Indicators */}
                    <div className="mt-6 space-y-3">
                        <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
                            <Lock className="w-4 h-4 text-green-600" />
                            <span className="font-medium">Your data is safe & secure</span>
                        </div>

                        <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
                            <div className="flex items-center gap-1">
                                <CheckCircle className="w-3 h-3 text-blue-500" />
                                <span>Owner-only access</span>
                            </div>
                            <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                            <div className="flex items-center gap-1">
                                <CheckCircle className="w-3 h-3 text-blue-500" />
                                <span>GST compliant</span>
                            </div>
                        </div>

                        <div className="text-center text-xs text-gray-500 pt-2">
                            Need help? <a href="#" className="text-blue-600 hover:underline font-medium">Contact support</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
