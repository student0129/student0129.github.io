#!/usr/bin/env python3
"""
Script to convert capability and breakthrough cards to interactive flip cards
"""

# Read the file
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Card 1: Descriptive Analytics - Flip Card
old_card_1 = '''                    <div class="premium-card">
                        <div class="icon" style="color: #FFB700; stroke: #FFB700 !important;"><i data-lucide="bar-chart-3"></i></div>
                        <h4 class="card-title text-white">Descriptive Analytics</h4>
                        <p class="text-white font-medium mb-3">Understanding What Happened</p>
                        <p class="text-slate-300 font-light mb-4"><strong class="text-white">What it does:</strong> Analyzes historical data to understand patterns, trends, and anomalies. Answers: "What happened? Why did it happen? Where are the patterns?"</p>
                        <p class="text-white font-medium mb-2">Example:</p>
                        <p class="text-slate-300 font-light mb-4">Across M&M's 240 trucks and InterRail's China-Europe corridors, descriptive analytics identifies: Which routes had highest delays last quarter? Which customs checkpoints create bottlenecks? Which corridors have seasonal demand spikes? Where are margin opportunities hidden in your operational data?</p>
                        <p class="text-cyan-400 font-medium text-sm">Business Impact:</p>
                        <ul class="space-y-2 mt-2 text-sm">
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Visibility across 100+ autonomous businesses without forcing integration</span>
                            </li>
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Identify inefficiencies and opportunities buried in operational data</span>
                            </li>
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Leadership gets unified intelligence while businesses maintain independence</span>
                            </li>
                        </ul>
                    </div>'''

new_card_1 = '''                    <div class="flip-card">
                        <div class="flip-card-inner">
                            <!-- Front -->
                            <div class="flip-card-front premium-card">
                                <div class="icon" style="color: #FFB700;"><i data-lucide="bar-chart-3"></i></div>
                                <h4 class="card-title text-white mb-3">Descriptive Analytics</h4>
                                <p class="text-xl text-slate-200 font-light mb-4">Understanding What Happened</p>
                                <p class="text-slate-300 font-light mb-6">Reveals patterns, inefficiencies, and opportunities hidden in your operational data across 100+ businesses.</p>
                                <button class="flip-btn" onclick="this.closest('.flip-card').classList.add('flipped')">
                                    Learn More <i data-lucide="arrow-right"></i>
                                </button>
                            </div>
                            <!-- Back -->
                            <div class="flip-card-back premium-card">
                                <button class="flip-btn mb-4" onclick="this.closest('.flip-card').classList.remove('flipped')">
                                    <i data-lucide="arrow-left"></i> Back
                                </button>
                                <h4 class="card-title text-white mb-3">Descriptive Analytics</h4>
                                <p class="text-slate-300 font-light text-sm mb-4"><strong class="text-white">What it does:</strong> Analyzes historical patterns. Answers: "What happened? Why? Where are the patterns?"</p>
                                <p class="text-white font-medium text-sm mb-2">Example:</p>
                                <p class="text-slate-300 font-light text-sm mb-4">Which routes had highest delays? Which customs checkpoints bottleneck? Where are margin opportunities hidden?</p>
                                <p class="text-cyan-400 font-medium text-sm mb-2">Business Impact:</p>
                                <ul class="space-y-2 text-sm">
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Visibility across 100+ businesses</strong> without forcing integration</span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Surface inefficiencies</strong> buried in data</span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Unified intelligence</strong> with maintained autonomy</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>'''

content = content.replace(old_card_1, new_card_1)

# Card 2: Predictive Analytics
old_card_2 = '''                    <div class="premium-card">
                        <div class="icon" style="color: #FFB700; stroke: #FFB700 !important;"><i data-lucide="trending-up"></i></div>
                        <h4 class="card-title text-white">Predictive Analytics</h4>
                        <p class="text-white font-medium mb-3">Forecasting What Will Happen</p>
                        <p class="text-slate-300 font-light mb-4"><strong class="text-white">What it does:</strong> Uses historical patterns + current signals to forecast future scenarios with confidence levels. Answers: "What will happen next? How likely? What are the risks?"</p>
                        <p class="text-white font-medium mb-2">Example:</p>
                        <p class="text-slate-300 font-light mb-4"><em>"Vietnam corridor demand: 82% probability of 25% growth in next 6 months. Early indicators: M&M volume spikes, warehouse inquiries up 20%, financing requests increasing. Recommend: Pre-position warehouses + financing packages now."</em></p>
                        <p class="text-cyan-400 font-medium text-sm">Business Impact:</p>
                        <ul class="space-y-2 mt-2 text-sm">
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Anticipate opportunities and risks 6-12 months before competitors</span>
                            </li>
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Shift from reactive firefighting to proactive positioning</span>
                            </li>
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Leadership makes strategic bets with confidence levels, not gut instinct</span>
                            </li>
                        </ul>
                    </div>'''

new_card_2 = '''                    <div class="flip-card">
                        <div class="flip-card-inner">
                            <!-- Front -->
                            <div class="flip-card-front premium-card">
                                <div class="icon" style="color: #FFB700;"><i data-lucide="trending-up"></i></div>
                                <h4 class="card-title text-white mb-3">Predictive Analytics</h4>
                                <p class="text-xl text-slate-200 font-light mb-4">Forecasting What Will Happen</p>
                                <p class="text-slate-300 font-light mb-6">Forecasts opportunities and risks 6-12 months early with confidence levels—turning foresight into competitive advantage.</p>
                                <button class="flip-btn" onclick="this.closest('.flip-card').classList.add('flipped')">
                                    Learn More <i data-lucide="arrow-right"></i>
                                </button>
                            </div>
                            <!-- Back -->
                            <div class="flip-card-back premium-card">
                                <button class="flip-btn mb-4" onclick="this.closest('.flip-card').classList.remove('flipped')">
                                    <i data-lucide="arrow-left"></i> Back
                                </button>
                                <h4 class="card-title text-white mb-3">Predictive Analytics</h4>
                                <p class="text-slate-300 font-light text-sm mb-4"><strong class="text-white">What it does:</strong> Forecasts future scenarios with confidence levels. "What will happen next? How likely?"</p>
                                <p class="text-white font-medium text-sm mb-2">Example:</p>
                                <p class="text-slate-300 font-light text-sm mb-4"><em>"Vietnam corridor: 82% probability of 25% growth. Recommend: Pre-position warehouses now."</em></p>
                                <p class="text-cyan-400 font-medium text-sm mb-2">Business Impact:</p>
                                <ul class="space-y-2 text-sm">
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">See 6-12 months ahead</strong> of competitors</span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Shift to proactive positioning</strong></span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Strategic bets with confidence</strong>, not gut</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>'''

content = content.replace(old_card_2, new_card_2)

# Card 3: Prescriptive Analytics
old_card_3 = '''                    <div class="premium-card">
                        <div class="icon" style="color: #FFB700; stroke: #FFB700 !important;"><i data-lucide="route"></i></div>
                        <h4 class="card-title text-white">Prescriptive Analytics</h4>
                        <p class="text-white font-medium mb-3">Optimizing What to Do</p>
                        <p class="text-slate-300 font-light mb-4"><strong class="text-white">What it does:</strong> Recommends optimal actions by evaluating thousands of scenarios simultaneously. Answers: "What should we do? What's the best decision given our constraints?"</p>
                        <p class="text-white font-medium mb-2">Example:</p>
                        <p class="text-slate-300 font-light mb-4"><em>"Route 240 trucks through alternative corridors + allocate warehouse capacity across 3 hubs + structure financing terms for 15 customers—all optimized together for maximum margin, speed, and customer satisfaction across competing business constraints."</em></p>
                        <p class="text-cyan-400 font-medium text-sm">Business Impact:</p>
                        <ul class="space-y-2 mt-2 text-sm">
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Coordinate complex decisions across autonomous businesses without forcing centralization</span>
                            </li>
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Find optimal solutions humans can't calculate across multi-dimensional constraints</span>
                            </li>
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Turn operational complexity into competitive advantage</span>
                            </li>
                        </ul>
                    </div>'''

new_card_3 = '''                    <div class="flip-card">
                        <div class="flip-card-inner">
                            <!-- Front -->
                            <div class="flip-card-front premium-card">
                                <div class="icon" style="color: #FFB700;"><i data-lucide="route"></i></div>
                                <h4 class="card-title text-white mb-3">Prescriptive Analytics</h4>
                                <p class="text-xl text-slate-200 font-light mb-4">Optimizing What to Do</p>
                                <p class="text-slate-300 font-light mb-6">Recommends optimal actions by evaluating thousands of scenarios—turning complexity into advantage.</p>
                                <button class="flip-btn" onclick="this.closest('.flip-card').classList.add('flipped')">
                                    Learn More <i data-lucide="arrow-right"></i>
                                </button>
                            </div>
                            <!-- Back -->
                            <div class="flip-card-back premium-card">
                                <button class="flip-btn mb-4" onclick="this.closest('.flip-card').classList.remove('flipped')">
                                    <i data-lucide="arrow-left"></i> Back
                                </button>
                                <h4 class="card-title text-white mb-3">Prescriptive Analytics</h4>
                                <p class="text-slate-300 font-light text-sm mb-4"><strong class="text-white">What it does:</strong> Recommends optimal actions. "What should we do? What's best?"</p>
                                <p class="text-white font-medium text-sm mb-2">Example:</p>
                                <p class="text-slate-300 font-light text-sm mb-4"><em>"Route 240 trucks + allocate warehouses + structure financing—optimized for margin, speed, satisfaction."</em></p>
                                <p class="text-cyan-400 font-medium text-sm mb-2">Business Impact:</p>
                                <ul class="space-y-2 text-sm">
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Coordinate complex decisions</strong> without centralization</span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Solve multi-dimensional</strong> constraints</span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Complexity becomes advantage</strong></span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>'''

content = content.replace(old_card_3, new_card_3)

# Write back to file
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Successfully converted 3 capability cards to flip cards!")
print("📄 Backup saved as: index_before_flip_cards.html")
