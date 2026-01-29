import React from 'react';
import { format } from 'date-fns';

export interface MaterialRequestPDFProps {
    id?: string;
    poNumber: string;
    date: Date | string;
    vendorName: string;
    senderName: string;
    senderPhone: string;
    notes?: string;
    items: {
        partNumber: string;
        description: string;
        quantity: number;
    }[];
    pageIndex: number;
    totalPages: number;
    startItemNumber: number;
}

const MaterialRequestPDF: React.FC<MaterialRequestPDFProps> = ({
    id,
    poNumber,
    date,
    vendorName,
    notes,
    items,
    pageIndex,
    totalPages,
    startItemNumber
}) => {
    const formattedDate = date instanceof Date ? format(date, 'dd/MM/yyyy') : date;
    const isFirstPage = pageIndex === 0;
    const isLastPage = pageIndex === totalPages - 1;

    return (
        <>
            <style dangerouslySetInnerHTML={{
                __html: `
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Oswald:wght@500;700&display=swap');
            @page { size: A4; margin: 0; }
            @media print {
                body { -webkit-print-color-adjust: exact; }
            }
        `}} />

            <div
                id={id || "material-request-pdf"}
                className="bg-white text-gray-900 max-w-[210mm] mx-auto min-h-[297mm] flex flex-col relative shadow-2xl print:shadow-none font-sans"
                style={{ width: '210mm', fontFamily: "'Inter', sans-serif" }}
            >
                {/* 1. Official Header Section - Repeats on every page */}
                <div className="px-8 pt-16 pb-6 border-b-2 border-gray-800">
                    <div className="flex justify-between items-start">
                        {/* Top Left: Brand Identity (Dark Navy) */}
                        <div className="flex flex-col max-w-[60%]">
                            <h1 className="text-5xl font-extrabold text-[#1a237e] tracking-tight uppercase leading-none mb-3">
                                NEHA AUTO STORES
                            </h1>
                            <p className="text-sm text-gray-700 font-medium leading-relaxed max-w-[90%]">
                                5, Shri Datta nagar, Opp. Yogeshwari Mahavidyalaya,<br />
                                Ambajogai - Dist. Beed 431517
                            </p>
                        </div>

                        {/* Top Right: Title & Meta */}
                        <div className="flex flex-col items-end min-w-[35%]">
                            <div className="bg-blue-700 text-white px-10 py-3 rounded-md mb-8 shadow-sm">
                                <span className="text-xl font-bold tracking-widest uppercase">MATERIAL REQUEST</span>
                            </div>
                            <div className="text-right space-y-3 w-full">
                                <div className="flex justify-end items-center gap-4 border-b border-gray-100 pb-1">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest w-24 text-right">Page</span>
                                    <span className="text-base font-bold text-gray-900 w-40 text-right">{pageIndex + 1} of {totalPages}</span>
                                </div>
                                <div className="flex justify-end items-center gap-4 border-b border-gray-100 pb-1">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest w-24 text-right">Date</span>
                                    <span className="text-base font-bold text-gray-900 w-40 text-right">{formattedDate}</span>
                                </div>
                                <div className="flex justify-end items-center gap-4 pt-1">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest w-24 text-right">PO Number</span>
                                    <span className="text-lg font-mono font-bold text-gray-900 w-40 text-right tracking-wide whitespace-nowrap">
                                        {poNumber}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Smart Layout Contact Box - ONLY ON FIRST PAGE */}
                {isFirstPage && (
                    <div className="px-5 py-4">
                        <div className="border-2 border-gray-300 bg-gray-50 flex">
                            {/* Left: Request To (Vendor) */}
                            <div className="w-[60%] p-4 border-r-2 border-gray-300">
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">REQUEST TO (VENDOR)</p>
                                <p className="text-xl font-bold text-gray-900">{vendorName}</p>
                            </div>
                            {/* Right: Site Contact */}
                            <div className="w-[40%] p-4">
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">SITE CONTACT</p>
                                <div className="flex flex-col">
                                    <span className="text-xl font-bold text-gray-900">Mr. Adnak</span>
                                    <span className="text-lg font-bold text-gray-900 tracking-wide">9822197172</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 3. The Table (Tally/Excel Style - Full Grid) */}
                <div className="px-5 mb-auto">
                    <table className="w-full border-collapse border-2 border-gray-300">
                        <thead>
                            <tr className="bg-blue-700 text-white">
                                <th className="py-3 px-3 text-center w-16 text-sm font-bold uppercase tracking-wider border border-gray-300">#</th>
                                <th className="py-3 px-3 text-left w-48 text-sm font-bold uppercase tracking-wider border border-gray-300">Part Number</th>
                                <th className="py-3 px-3 text-left text-sm font-bold uppercase tracking-wider border border-gray-300">Description</th>
                                <th className="py-3 px-3 text-right w-32 text-sm font-bold uppercase tracking-wider border border-gray-300">Quantity</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, index) => (
                                <tr
                                    key={index}
                                    className="bg-white"
                                >
                                    <td className="py-3 px-3 text-center text-gray-700 text-sm font-semibold border border-gray-300">
                                        {startItemNumber + index}
                                    </td>
                                    <td className="py-3 px-3 text-left font-mono font-bold text-gray-900 text-base border border-gray-300">
                                        {item.partNumber}
                                    </td>
                                    <td className="py-3 px-3 text-left text-gray-800 font-medium text-sm border border-gray-300">
                                        {item.description}
                                    </td>
                                    <td className="py-3 px-3 text-right border border-gray-300">
                                        <span className="text-lg font-extrabold text-gray-900">{item.quantity}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* 4. Footer Section - ONLY ON LAST PAGE */}
                {isLastPage ? (
                    <div className="px-10 pb-8 mt-4">
                        {/* Vendor Note - Only show if notes exist */}
                        {notes && notes.trim() !== "" && (
                            <div className="border border-gray-300 bg-yellow-50 p-3 mb-6">
                                <p className="text-sm text-gray-800 font-semibold italic text-center">
                                    "Note: {notes}"
                                </p>
                            </div>
                        )}

                        {/* Footer Bottom Layout */}
                        <div className="flex justify-between items-end border-t-2 border-gray-800 pt-6">
                            <div className="text-left">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Digitally Generated | Verified Request</p>
                            </div>

                            {/* Trust Seal / Digital Stamp - Refined */}
                            <div className="flex flex-col items-center">
                                <div className="border-2 border-gray-200 rounded-xl p-3 bg-white flex flex-col items-center shadow-sm min-w-[140px]">
                                    <img
                                        src="/digientry_seal.png"
                                        alt="DigiEntry"
                                        className="h-14 object-contain mb-1" /* Increased size */
                                    />
                                    {/* Text labels removed for Top 1% cleaner look */}
                                    <a href="https://www.mydigientry.com" className="text-[10px] text-blue-600 hover:text-blue-800 font-medium mt-1">
                                        www.mydigientry.com
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Optional: Message for intermediate pages */
                    <div className="px-10 pb-8 mt-4 text-center">
                        <p className="text-sm text-gray-400 italic">Continued on next page...</p>
                    </div>
                )}
            </div>
        </>
    );
};

export default MaterialRequestPDF;
