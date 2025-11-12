#!/usr/bin/env python3
"""
Script to properly restructure the Three Horizons sections with tabbed interfaces and yellow icons.
"""

import re

# Read the file
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the Horizon 1 section and replace it
horizon1_pattern = r'(<!-- Horizon 1 -->.*?)(<!-- Horizon 2 -->)'

horizon1_replacement = '''<!-- Horizon 1 -->
                    <div id="h1" class="horizon-content-section">
                        <div class="premium-card">
                            <h4 class="card-title text-white">Horizon 1: Mitigate Risk & Build Foundation</h4>
                            <p class="text-lg text-slate-300 mb-8 font-light">Stop losing money to preventable problems. These initiatives reduce operational risk, improve efficiency, and pay for themselves in months—giving CFOs immediate ROI while building the foundation for strategic AI.</p>
                            
                            <!-- Tabbed Interface -->
                            <div class="horizon-tabs" data-horizon="h1">
                                <div class="tab-buttons">
                                    <button class="tab-button active" data-tab="h1-logistics">Transport & Logistics</button>
                                    <button class="tab-button" data-tab="h1-realestate">Real Estate</button>
                                    <button class="tab-button" data-tab="h1-financing">Financing</button>
                                </div>
                                
                                <!-- Transport & Logistics Tab -->
                                <div class="tab-content active" data-tab-content="h1-logistics">
                                    <p class="text-sm text-cyan-400 font-medium mb-4 uppercase tracking-wide">Quick Wins (3-6 months, Immediate ROI)</p>
                                    <ul class="space-y-4">
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="Traditional Analytics"><i data-lucide="search"></i></span>
                                            <div>
                                                <strong class="text-white">Freight Matching & Empty Mile Reduction.</strong> Machine learning identifies empty backhaul opportunities across M&M's network. <strong class="text-white">Impact:</strong> Reduce empty miles by 12-18%, improve truck utilization, immediate cost savings. <strong class="text-white">Timeline:</strong> 3-6 months for initial corridors.
                                            </div>
                                        </li>
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="Traditional Analytics"><i data-lucide="search"></i></span>
                                            <div>
                                                <strong class="text-white">Customs & Border Delay Prediction.</strong> Predict where delays will occur (sanctions checks, gauge changes, document issues) and proactively reroute or adjust schedules. <strong class="text-white">Impact:</strong> Reduce border delays by 20-30%, fewer demurrage charges. <strong class="text-white">Timeline:</strong> 4-6 months.
                                            </div>
                                        </li>
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="Predictive AI"><i data-lucide="dice-6"></i></span>
                                            <div>
                                                <strong class="text-white">Rail & Intermodal Predictive Maintenance.</strong> Reduce unplanned downtime for rail assets (locomotives, wagons, gauge-change equipment). <strong class="text-white">Impact:</strong> 15-25% reduction in maintenance costs, fewer service disruptions. <strong class="text-white">Timeline:</strong> 6 months for pilot corridors.
                                            </div>
                                        </li>
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="LLM-Powered"><i data-lucide="message-square"></i></span>
                                            <div>
                                                <strong class="text-white">Automated Customs Documentation (Turkey-Central Asia).</strong> LLMs generate compliant customs declarations across CIS, Turkey, and EU regulatory zones—in multiple languages with proper HS codes. <strong class="text-white">Impact:</strong> 60-80% reduction in documentation time, fewer rejections. <strong class="text-white">Timeline:</strong> 3-4 months.
                                            </div>
                                        </li>
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="LLM-Powered"><i data-lucide="message-square"></i></span>
                                            <div>
                                                <strong class="text-white">Customer Service Automation Across Languages.</strong> LLM-powered chatbots handle routine inquiries in Turkish, Russian, Kazakh, and English—freeing up humans for complex issues. <strong class="text-white">Impact:</strong> 40-50% reduction in support tickets, faster response times. <strong class="text-white">Timeline:</strong> 3-4 months.
                                            </div>
                                        </li>
                                    </ul>
                                    <p class="text-sm text-slate-300 font-medium mt-8 mb-4 uppercase tracking-wide">Foundation Builds (6-12 months)</p>
                                    <ul class="space-y-4">
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="LLM-Powered"><i data-lucide="message-square"></i></span>
                                            <div>
                                                <strong class="text-white">Automated Document Processing (Contracts, Invoices, Bills of Lading).</strong> Extract structured data from PDFs, emails, scanned documents across multiple languages and regulatory formats. <strong class="text-white">Impact:</strong> 70% faster processing, fewer manual errors. <strong class="text-white">Timeline:</strong> 6-9 months.
                                            </div>
                                        </li>
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="Computer Vision"><i data-lucide="scan"></i></span>
                                            <div>
                                                <strong class="text-white">Real-Time Asset Tracking & Damage Detection.</strong> Satellite imagery and on-site cameras track 240 trucks across Eurasian corridors. Visual inspection detects cargo damage before it becomes a claim. <strong class="text-white">Impact:</strong> Real-time visibility, 30% reduction in damage claims. <strong class="text-white">Timeline:</strong> 9-12 months.
                                            </div>
                                        </li>
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="Optimization AI"><i data-lucide="route"></i></span>
                                            <div>
                                                <strong class="text-white">Multimodal Route Optimization (Road + Rail + Ferry).</strong> Dynamically optimize routes considering gauge changes, border efficiency, seasonal capacity, and geopolitical risk. <strong class="text-white">Impact:</strong> Reduces operational costs and improves existing service efficiency. <strong class="text-white">Timeline:</strong> 9-12 months for initial corridors.
                                            </div>
                                        </li>
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="Optimization AI"><i data-lucide="route"></i></span>
                                            <div>
                                                <strong class="text-white">Control Tower with Real-Time Exception Alerts.</strong> Unified view of shipments across road, rail, ferry with AI-powered alerts for delays, capacity issues, compliance risks. <strong class="text-white">Impact:</strong> Proactive problem-solving, fewer customer escalations. <strong class="text-white">Timeline:</strong> 9-12 months.
                                            </div>
                                        </li>
                                    </ul>
                                </div>
                                
                                <!-- Real Estate Tab -->
                                <div class="tab-content" data-tab-content="h1-realestate">
                                    <p class="text-sm text-cyan-400 font-medium mb-4 uppercase tracking-wide">Quick Wins (3-6 months, Immediate ROI)</p>
                                    <ul class="space-y-4">
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="Traditional Analytics"><i data-lucide="search"></i></span>
                                            <div>
                                                <strong class="text-white">Lease Analysis & Expiry Alerts.</strong> Traditional analytics track lease terms, flag upcoming renewals, and identify cost-saving consolidation opportunities across your warehouse network. <strong class="text-white">Impact:</strong> Avoid missed renewals, negotiate better terms, reduce real estate costs. <strong class="text-white">Timeline:</strong> 3-6 months.
                                            </div>
                                        </li>
                                    </ul>
                                </div>
                                
                                <!-- Financing Tab -->
                                <div class="tab-content" data-tab-content="h1-financing">
                                    <p class="text-sm text-cyan-400 font-medium mb-4 uppercase tracking-wide">Quick Wins (3-6 months, Immediate ROI)</p>
                                    <ul class="space-y-4">
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="Traditional Analytics"><i data-lucide="search"></i></span>
                                            <div>
                                                <strong class="text-white">Credit Risk Scoring for SME Borrowers.</strong> Traditional AI models assess creditworthiness of SME clients seeking financing for logistics services or equipment purchases. <strong class="text-white">Impact:</strong> Faster approvals, lower default rates, expand financing portfolio safely. <strong class="text-white">Timeline:</strong> 6-9 months.
                                            </div>
                                        </li>
                                        <li class="flex items-start text-slate-300">
                                            <span class="tech-icon" title="Predictive AI"><i data-lucide="dice-6"></i></span>
                                            <div>
                                                <strong class="text-white">Automated Collections & Payment Prediction.</strong> Predictive AI identifies which invoices are at risk of late payment and automates dunning workflows. <strong class="text-white">Impact:</strong> Improve cash flow, reduce DSO (Days Sales Outstanding). <strong class="text-white">Timeline:</strong> 6-9 months.
                                            </div>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Horizon 2 -->'''

content = re.sub(horizon1_pattern, horizon1_replacement + r'\2', content, flags=re.DOTALL)

# Write back
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Horizon 1 restructured successfully!")
