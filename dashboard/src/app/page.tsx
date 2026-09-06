"use client";

import React, { useEffect, useState } from "react";
import Head from "next/head";

// Mock types
interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

interface Order {
  id: string;
  agent_type: string;
  amount: number;
  status: string;
  flagged: boolean;
}

export default function Dashboard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In a real implementation we'd fetch from our backend
    // fetch('http://localhost:3001/catalog').then(...)
    setTimeout(() => {
      setProducts([
        { id: "prod_1", name: "AI Premium Subscription", price: 4900, stock: 100 },
        { id: "prod_2", name: "Agent Compute Credits (1000)", price: 1500, stock: 5000 },
        { id: "prod_3", name: "Enterprise API Access", price: 19900, stock: 50 },
      ]);
      setOrders([
        { id: "ord_a1", agent_type: "mcp_claude", amount: 4900, status: "COMPLETED", flagged: false },
        { id: "ord_b2", agent_type: "acp_chatgpt", amount: 1500, status: "PENDING", flagged: false },
        { id: "ord_c3", agent_type: "ap2_gemini", amount: 199000, status: "FLAGGED", flagged: true }, // Suspicious order
      ]);
      setLoading(false);
    }, 1000);
  }, []);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans overflow-x-hidden selection:bg-indigo-500 selection:text-white">
      <Head>
        <title>AgentBridge Dashboard</title>
      </Head>

      {/* Decorative background blurs */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-900/30 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-rose-900/20 blur-[120px] pointer-events-none" />

      <main className="relative max-w-7xl mx-auto px-6 py-12">
        <header className="flex justify-between items-end mb-12">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-rose-400 text-transparent bg-clip-text animate-pulse">
              AgentBridge
            </h1>
            <p className="text-gray-400 mt-2">Unified AI Commerce Dashboard</p>
          </div>
          <button className="px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-sm font-medium transition-all duration-300 shadow-[0_0_15px_rgba(255,255,255,0.05)] hover:shadow-[0_0_25px_rgba(255,255,255,0.1)]">
            Sync Razorpay
          </button>
        </header>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Stats Overview */}
            <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { label: "Total Revenue", value: "$215.00" },
                { label: "AI Agents active", value: "3 protocols" },
                { label: "Orders Today", value: "24" },
                { label: "Fraud Flags", value: "1", alert: true }
              ].map((stat, i) => (
                <div key={i} className={`p-6 rounded-2xl bg-white/[0.02] border backdrop-blur-xl transition-transform hover:-translate-y-1 duration-300 ${stat.alert ? 'border-rose-500/50 shadow-[0_0_30px_rgba(244,63,94,0.1)]' : 'border-white/5'}`}>
                  <p className="text-sm text-gray-400 font-medium">{stat.label}</p>
                  <p className={`text-3xl font-bold mt-2 ${stat.alert ? 'text-rose-400' : 'text-white'}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Catalog */}
            <div className="lg:col-span-1 space-y-6">
              <h2 className="text-xl font-semibold border-b border-white/10 pb-4">Live Catalog</h2>
              <div className="space-y-4">
                {products.map((product) => (
                  <div key={product.id} className="p-4 rounded-xl bg-white/[0.01] border border-white/5 hover:bg-white/[0.03] transition-colors">
                    <h3 className="font-medium">{product.name}</h3>
                    <div className="flex justify-between items-center mt-3 text-sm text-gray-400">
                      <span>${(product.price / 100).toFixed(2)}</span>
                      <span className="px-2 py-1 rounded bg-white/5">{product.stock} in stock</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Orders Feed */}
            <div className="lg:col-span-2 space-y-6">
              <h2 className="text-xl font-semibold border-b border-white/10 pb-4">Recent Agent Orders</h2>
              
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden backdrop-blur-md">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.02] border-b border-white/10 text-sm text-gray-400">
                      <th className="p-4 font-medium">Order ID</th>
                      <th className="p-4 font-medium">Agent Protocol</th>
                      <th className="p-4 font-medium">Amount</th>
                      <th className="p-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="p-4 font-mono text-sm">{order.id}</td>
                        <td className="p-4">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 text-xs font-medium uppercase tracking-wider text-gray-300">
                            {order.agent_type.split('_')[1]} ({order.agent_type.split('_')[0]})
                          </span>
                        </td>
                        <td className="p-4">${(order.amount / 100).toFixed(2)}</td>
                        <td className="p-4">
                          {order.flagged ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-400 text-xs font-medium border border-rose-500/20 animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                              FLAGGED
                            </span>
                          ) : (
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                              order.status === 'COMPLETED' 
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${order.status === 'COMPLETED' ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                              {order.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
