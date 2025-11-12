#!/usr/bin/env python3
"""
Script to convert New Frontier cards to interactive flip cards
"""

# Read the file
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Card 4: Large Language Models (LLMs)
old_card_4 = '''                    <div class="premium-card">
                        <div class="icon" style="color: #06b6d4;"><i data-lucide="brain"></i></div>
                        <h4 class="card-title text-white">Large Language Models (LLMs)</h4>
                        <p class="text-white font-medium mb-3">Handle Linguistic & Regulatory Complexity at Scale</p>
                        
                        <div class="mb-4">
                            <p class="text-cyan-400 font-medium text-sm mb-2">What Changed:</p>
                            <p class="text-slate-300 font-light text-sm">Traditional AI couldn't handle messy text, ambiguous language, or complex regulatory documents. LLMs can read, understand context, and reason across languages and domains like a skilled analyst—but instantaneously and at massive scale.</p>
                        </div>
                        
                        <div class="mb-4">
                            <p class="text-white font-medium text-sm mb-2">What They Do:</p>
                            <ul class="space-y-2 text-sm">
                                <li class="flex items-start text-slate-300">
                                    <span class="text-cyan-400 mr-2">•</span>
                                    <span class="font-light"><strong class="text-white">Interpret:</strong> Extract structured insights from unstructured docs (trade laws, contracts, customs rules across 12 countries)</span>
                                </li>
                                <li class="flex items-start text-slate-300">
                                    <span class="text-cyan-400 mr-2">•</span>
                                    <span class="font-light"><strong class="text-white">Translate:</strong> Convert between systems, languages, business contexts without manual coding</span>
                                </li>
                                <li class="flex items-start text-slate-300">
                                    <span class="text-cyan-400 mr-2">•</span>
                                    <span class="font-light"><strong class="text-white">Generate:</strong> Draft contracts, regulatory filings, customer communications in multiple languages</span>
                                </li>
                                <li class="flex items-start text-slate-300">
                                    <span class="text-cyan-400 mr-2">•</span>
                                    <span class="font-light"><strong class="text-white">Reason:</strong> Answer complex questions combining regulatory knowledge with operational context</span>
                                </li>
                            </ul>
                        </div>
                        
                        <p class="text-white font-medium text-sm mb-2">Example:</p>
                        <p class="text-slate-300 font-light text-sm mb-4"><em>"Kazakhstan customs changed dual-use tech rules. LLM reads regulation, identifies affected shipments, flags compliance issues in Russian/Kazakh/English, suggests routing alternatives—all in minutes vs. weeks of manual legal review."</em></p>
                        
                        <p class="text-cyan-400 font-medium text-sm">Business Impact:</p>
                        <ul class="space-y-2 mt-2 text-sm">
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Turn regulatory complexity from barrier into speed advantage</span>
                            </li>
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Scale expertise across languages/regions without proportional headcount</span>
                            </li>
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Respond to regulatory changes in hours instead of weeks</span>
                            </li>
                        </ul>
                    </div>'''

new_card_4 = '''                    <div class="flip-card">
                        <div class="flip-card-inner">
                            <!-- Front -->
                            <div class="flip-card-front premium-card">
                                <div class="icon" style="color: #06b6d4;"><i data-lucide="brain"></i></div>
                                <h4 class="card-title text-white mb-3">Large Language Models</h4>
                                <p class="text-xl text-slate-200 font-light mb-4">Handle Linguistic & Regulatory Complexity at Scale</p>
                                <p class="text-slate-300 font-light mb-6">Reads complex regulations, translates contexts, and responds to changes in hours—not weeks.</p>
                                <button class="flip-btn" onclick="this.closest('.flip-card').classList.add('flipped')">
                                    Learn More <i data-lucide="arrow-right"></i>
                                </button>
                            </div>
                            <!-- Back -->
                            <div class="flip-card-back premium-card">
                                <button class="flip-btn mb-4" onclick="this.closest('.flip-card').classList.remove('flipped')">
                                    <i data-lucide="arrow-left"></i> Back
                                </button>
                                <h4 class="card-title text-white mb-3">Large Language Models</h4>
                                <p class="text-cyan-400 font-medium text-sm mb-2">What Changed:</p>
                                <p class="text-slate-300 font-light text-sm mb-3">LLMs understand context and reason across languages like a skilled analyst—instantaneously at massive scale.</p>
                                
                                <p class="text-white font-medium text-sm mb-2">What They Do:</p>
                                <ul class="space-y-1 text-sm mb-3">
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Interpret</strong> complex regulations across 12 countries</span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Translate</strong> between systems and languages</span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Generate</strong> contracts and filings</span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Reason</strong> with regulatory + operational context</span>
                                    </li>
                                </ul>
                                
                                <p class="text-white font-medium text-sm mb-1">Example:</p>
                                <p class="text-slate-300 font-light text-sm mb-3"><em>"Kazakhstan customs rule changes → Identify affected shipments + flag compliance issues + suggest alternatives—minutes vs. weeks."</em></p>
                                
                                <p class="text-cyan-400 font-medium text-sm mb-2">Business Impact:</p>
                                <ul class="space-y-1 text-sm">
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Complexity becomes speed</strong></span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Scale expertise</strong> without headcount</span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Hours, not weeks</strong> for regulatory response</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>'''

content = content.replace(old_card_4, new_card_4)

# Card 5: AI Agents
old_card_5 = '''                    <div class="premium-card">
                        <div class="icon" style="color: #06b6d4;"><i data-lucide="bot"></i></div>
                        <h4 class="card-title text-white">AI Agents</h4>
                        <p class="text-white font-medium mb-3">Coordinate Intelligence & Actions Autonomously</p>
                        
                        <div class="mb-4">
                            <p class="text-cyan-400 font-medium text-sm mb-2">What Changed:</p>
                            <p class="text-slate-300 font-light text-sm">Traditional automation required rigid workflows. AI Agents reason, plan multi-step actions, use tools, and adapt to unexpected situations—like having a smart analyst working 24/7 across your autonomous businesses.</p>
                        </div>
                        
                        <div class="mb-4">
                            <p class="text-white font-medium text-sm mb-2">What They Are:</p>
                            <p class="text-slate-300 font-light text-sm">LLMs + ability to take actions in systems + reasoning about goals. They observe situations, decide what to do, execute actions, and adapt based on results—without human intervention for every step.</p>
                        </div>
                        
                        <p class="text-white font-medium text-sm mb-2">Example:</p>
                        <p class="text-slate-300 font-light text-sm mb-4"><em>"Russia announces new China trade policy. Agent monitors announcement → evaluates impact on InterRail's 47 affected routes → queries M&M's available truck capacity → checks TransCapital's warehouse availability → drafts 3 contingency scenarios with cost/time tradeoffs → alerts leadership with actionable options, all coordinated autonomously."</em></p>
                        
                        <p class="text-cyan-400 font-medium text-sm">Business Impact:</p>
                        <ul class="space-y-2 mt-2 text-sm">
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Coordinate complex workflows across silos without forcing integration</span>
                            </li>
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">Leadership focuses on strategic decisions while agents handle coordination</span>
                            </li>
                            <li class="flex items-start text-slate-300">
                                <span class="text-cyan-400 mr-2">•</span>
                                <span class="font-light">24/7 intelligent monitoring and response across time zones and languages</span>
                            </li>
                        </ul>
                    </div>'''

new_card_5 = '''                    <div class="flip-card">
                        <div class="flip-card-inner">
                            <!-- Front -->
                            <div class="flip-card-front premium-card">
                                <div class="icon" style="color: #06b6d4;"><i data-lucide="bot"></i></div>
                                <h4 class="card-title text-white mb-3">AI Agents</h4>
                                <p class="text-xl text-slate-200 font-light mb-4">Coordinate Intelligence & Actions Autonomously</p>
                                <p class="text-slate-300 font-light mb-6">Like having a smart analyst working 24/7 across businesses—reasoning, planning, adapting.</p>
                                <button class="flip-btn" onclick="this.closest('.flip-card').classList.add('flipped')">
                                    Learn More <i data-lucide="arrow-right"></i>
                                </button>
                            </div>
                            <!-- Back -->
                            <div class="flip-card-back premium-card">
                                <button class="flip-btn mb-4" onclick="this.closest('.flip-card').classList.remove('flipped')">
                                    <i data-lucide="arrow-left"></i> Back
                                </button>
                                <h4 class="card-title text-white mb-3">AI Agents</h4>
                                <p class="text-cyan-400 font-medium text-sm mb-2">What Changed:</p>
                                <p class="text-slate-300 font-light text-sm mb-3">Agents reason, plan, use tools, and adapt—not rigid automation.</p>
                                
                                <p class="text-white font-medium text-sm mb-2">What They Are:</p>
                                <p class="text-slate-300 font-light text-sm mb-3">LLMs + ability to take actions. They observe, decide, execute, adapt—autonomously.</p>
                                
                                <p class="text-white font-medium text-sm mb-1">Example:</p>
                                <p class="text-slate-300 font-light text-sm mb-3"><em>"Russia announces trade policy → Agent evaluates 47 routes → checks capacity → drafts scenarios → alerts leadership with options—all automated."</em></p>
                                
                                <p class="text-cyan-400 font-medium text-sm mb-2">Business Impact:</p>
                                <ul class="space-y-1 text-sm">
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Coordinate without forcing</strong> integration</span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">Leadership focuses</strong> on strategy</span>
                                    </li>
                                    <li class="flex items-start text-slate-300">
                                        <span class="text-cyan-400 mr-2">•</span>
                                        <span class="font-light"><strong class="text-white">24/7 intelligent monitoring</strong></span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>'''

content = content.replace(old_card_5, new_card_5)

# Write back to file
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Successfully converted 2 New Frontier cards to flip cards!")
print("🎉 All 5 cards now have interactive flip functionality!")
print("📄 Backup: index_before_flip_cards.html")
