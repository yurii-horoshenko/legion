// ── Agent character portrait mapping ──────────────────────────────────────
// Maps catalogId → token image path (served as static assets)

const P1 = n => `/assets/characters/Token Pack 1/Iron (${n}).png`;
const P2 = n => `/assets/characters/Token Pack 2/Metal (${n}).png`;

const CHARACTERS = {
  // ── Engineering ───────────────────────────────────────────────────────────
  'software-architect':                   P1(45), // wise blonde elf scholar
  'backend-architect':                    P1(4),  // brooding dark warrior — deep systems
  'frontend-developer':                   P1(50), // polished blonde in sleek black armor
  'frontend-architect':                   P1(19), // dark female in structured armor
  'mobile-app-builder':                   P1(12), // female in versatile golden armor
  'code-reviewer':                        P1(2),  // serious blonde elf — critical eye
  'technical-writer':                     P1(16), // male cleric — scholarly, careful
  'security-engineer':                    P1(17), // ninja with mask — stealth protection
  'threat-detection-engineer':            P1(17), // ninja — detection/stealth
  'api-tester':                           P1(25), // gunslinger — precision testing
  'devops-automator':                     P1(8),  // full plate knight — systematic automation
  'performance-benchmarker':              P1(3),  // elf with backpack — explorer/measurer
  'database-optimizer':                   P1(30), // dragonborn in robes — ancient data keeper
  'data-engineer':                        P2(7),  // rugged practical warrior
  'ai-engineer':                          P1(9),  // lizard creature — non-human AI
  'autonomous-optimization-architect':    P1(9),  // lizard — autonomous non-human
  'senior-developer':                     P1(5),  // seasoned dark male warrior
  'rapid-prototyper':                     P1(3),  // explorer with gear — quick builder
  'codebase-onboarding-engineer':         P1(16), // cleric/guide — welcoming
  'git-workflow-master':                  P1(17), // ninja — precise branching
  'incident-response-commander':          P1(7),  // paladin commander — crisis response
  'sre-site-reliability-engineer':        P1(35), // silver knight — reliable armor
  'embedded-firmware-engineer':           P1(8),  // full plate — hardware level
  'minimal-change-engineer':              P2(3),  // focused dark elf
  'email-intelligence-engineer':          P1(16), // cleric — communication intelligence
  'cms-developer':                        P1(50), // polished female developer
  'feishu-integration-developer':         P2(7),  // practical warrior
  'wechat-mini-program-developer':        P2(7),  // practical warrior
  'solidity-smart-contract-engineer':     P1(30), // dragonborn — blockchain/ancient
  'voice-ai-integration-engineer':        P2(45), // sorceress — voice/sound
  'ai-data-remediation-engineer':         P1(9),  // lizard — data AI
  'macos-spatial-metal-engineer':         P1(8),  // armored — metal/systems
  'visionos-spatial-engineer':            P1(13), // angel — spatial/elevated
  'xr-immersive-developer':               P1(13), // angel — immersive/elevated
  'xr-interface-architect':               P1(10), // blue elf paladin — interface/ethereal
  'xr-cockpit-interaction-specialist':    P1(10), // blue elf paladin
  'terminal-integration-specialist':      P1(17), // ninja — terminal stealth
  'lsp-index-engineer':                   P2(3),  // focused elf
  'filament-optimization-specialist':     P1(8),  // armored/hardware
  'mcp-builder':                          P1(3),  // explorer with tools
  'workflow-architect':                   P1(7),  // paladin — workflow orchestration
  'salesforce-architect':                 P1(7),  // paladin — CRM architect

  // ── Design / UX ───────────────────────────────────────────────────────────
  'ui-designer':                          P2(10), // ornate female — beautiful/noble
  'ux-architect':                         P2(35), // elf queen — structured design
  'ux-researcher':                        P2(3),  // focused female — research
  'visual-storyteller':                   P2(1),  // hooded mysterious female
  'image-prompt-engineer':                P1(13), // angel — creative/elevated
  'technical-artist':                     P1(13), // angel — art/tech blend
  'inclusive-visuals-specialist':         P1(6),  // dark-skinned female — inclusive
  'whimsy-injector':                      P1(1),  // cat-eared female — playful
  'accessibility-auditor':                P1(16), // cleric — careful/inclusive

  // ── Product / Management ──────────────────────────────────────────────────
  'product-manager':                      P1(7),  // paladin commander — strategic leader
  'studio-producer':                      P2(25), // knight — commanding
  'project-shepherd':                     P1(7),  // paladin — guiding
  'sprint-prioritizer':                   P2(7),  // practical warrior
  'chief-of-staff':                       P1(20), // female samurai — disciplined
  'agents-orchestrator':                  P1(7),  // paladin commander — orchestrating
  'senior-project-manager':               P1(20), // female samurai — experienced leader
  'studio-operations':                    P2(25), // knight — operations
  'jira-workflow-steward':                P2(7),  // practical warrior

  // ── Marketing / Content ───────────────────────────────────────────────────
  'brand-guardian':                       P2(35), // elf queen with crown — regal identity
  'content-creator':                      P2(50), // red-haired female — vibrant creative
  'growth-hacker':                        P1(21), // blue tiefling — cunning/unconventional
  'instagram-curator':                    P2(40), // blue-dressed girl — social/aesthetic
  'tiktok-strategist':                    P2(30), // female ninja — agile/quick
  'video-optimization-specialist':        P1(6),  // charming dark female — captivating
  'short-video-editing-coach':            P2(5),  // dark female warrior — sharp/precise
  'seo-specialist':                       P1(3),  // explorer — search/mapping
  'social-media-strategist':              P2(50), // vibrant red-haired
  'twitter-engager':                      P2(50), // vibrant red-haired
  'linkedin-content-creator':             P2(25), // professional knight
  'podcast-strategist':                   P2(45), // sorceress — voice/audio
  'book-co-author':                       P1(45), // wise elf scholar
  'agentic-search-optimizer':             P1(3),  // explorer/searcher
  'ai-citation-strategist':              P1(45), // elf scholar
  'app-store-optimizer':                  P1(3),  // explorer with gear
  'carousel-growth-engine':              P1(21), // cunning tiefling
  'reddit-community-builder':             P1(15), // adventurous rogue
  'douyin-strategist':                    P2(30), // agile ninja
  'kuaishou-strategist':                  P2(30), // agile ninja
  'bilibili-content-strategist':          P2(45), // creative sorceress
  'xiaohongshu-specialist':              P2(40), // aesthetic girl
  'weibo-strategist':                     P2(50), // vibrant
  'zhihu-strategist':                     P1(45), // wise scholar
  'wechat-official-account-manager':      P1(16), // cleric — communication
  'paid-media-auditor':                   P1(25), // gunslinger — precision
  'ad-creative-strategist':              P1(21), // cunning tiefling
  'paid-social-strategist':              P2(30), // agile ninja
  'ppc-campaign-strategist':             P1(25), // gunslinger — precision targeting
  'programmatic-display-buyer':          P2(7),  // practical warrior
  'search-query-analyst':                P1(3),  // explorer/searcher
  'tracking-measurement-specialist':     P1(25), // precision gunslinger
  'livestream-commerce-coach':           P2(45), // charismatic sorceress
  'private-domain-operator':             P1(17), // ninja — private/stealth
  'china-e-commerce-operator':           P2(7),  // practical warrior
  'cross-border-e-commerce-specialist':  P1(15), // adventurer/trader
  'china-market-localization-strategist':P2(35), // elf queen — cultural authority

  // ── Research / Academia ───────────────────────────────────────────────────
  'anthropologist':                       P2(2),  // old wise elf — long study
  'debate-coach':                         P1(4),  // brooding warrior — argumentative
  'geographer':                           P1(3),  // explorer with backpack
  'grant-writer':                         P1(16), // cleric scholar
  'historian':                            P2(2),  // elder elf — ancient knowledge
  'literature-reviewer':                  P1(45), // elf scholar
  'narratologist':                        P1(15), // storytelling adventurer
  'psychologist':                         P1(6),  // charming perceptive female
  'research-methodologist':              P2(3),  // focused female researcher
  'thesis-advisor':                       P1(45), // wise elf

  // ── Finance / Sales ───────────────────────────────────────────────────────
  'financial-analyst':                    P1(16), // cleric — careful with numbers
  'bookkeeper-controller':               P1(16), // cleric — precise records
  'tax-strategist':                       P1(17), // ninja — strategic/hidden
  'fp-a-analyst':                        P2(7),  // practical warrior
  'investment-researcher':               P1(45), // wise scholar
  'account-strategist':                  P2(25), // knight — strategic accounts
  'sales-coach':                          P1(15), // adventurous rogue
  'deal-strategist':                      P1(17), // ninja — deal closing
  'discovery-coach':                      P1(3),  // explorer — discovery
  'sales-engineer':                       P1(12), // technical warrior
  'outbound-strategist':                  P1(21), // cunning tiefling
  'pipeline-analyst':                     P2(7),  // practical warrior
  'proposal-strategist':                  P1(7),  // paladin — strong proposals

  // ── Game Development ─────────────────────────────────────────────────────
  'game-designer':                        P1(15), // pirate adventurer — creative
  'game-audio-engineer':                  P2(45), // sorceress — musical/magical
  'level-designer':                       P1(3),  // explorer — level mapping
  'narrative-designer':                   P1(15), // storytelling adventurer

  // ── QA / Testing ─────────────────────────────────────────────────────────
  'test-results-analyzer':               P1(2),  // critical serious elf
  'tool-evaluator':                       P1(25), // gunslinger — precision
  'evidence-collector':                   P1(18), // hooded female rogue — gathering
  'reality-checker':                      P1(2),  // serious critical elf
  'workflow-optimizer':                   P1(3),  // explorer — optimizing paths
  'experiment-tracker':                   P1(25), // gunslinger — precise tracking
  'model-qa-specialist':                  P2(3),  // focused researcher
  'analytics-reporter':                   P1(16), // cleric — reporting/documenting

  // ── Operations / Enterprise ───────────────────────────────────────────────
  'customer-service':                     P1(6),  // charming dark female
  'healthcare-customer-service':          P1(13), // angel — care/healing
  'hospitality-guest-services':           P2(10), // noble ornate female
  'hr-onboarding':                        P1(16), // cleric — welcoming guide
  'recruitment-specialist':               P2(7),  // practical warrior
  'legal-document-review':               P1(2),  // critical elf
  'legal-client-intake':                  P1(6),  // charming welcoming female
  'legal-billing-time-tracking':         P1(16), // cleric — precise records
  'compliance-auditor':                   P1(8),  // armored knight — strict compliance
  'corporate-training-designer':         P1(16), // cleric — teaching
  'blockchain-security-auditor':         P1(17), // ninja — stealth security
  'automation-governance-architect':     P1(8),  // knight — governance/automation
  'agentic-identity-trust-architect':    P1(7),  // paladin — trust/identity
  'identity-graph-operator':             P2(20), // mysterious dark female
  'language-translator':                  P2(2),  // wise elder elf — languages
  'loan-officer-assistant':              P1(16), // cleric — careful records
  'real-estate-buyer-seller':            P1(15), // adventurer/trader
  'report-distribution-agent':           P1(16), // cleric — documentation
  'retail-customer-returns':             P1(6),  // charming helpful female
  'sales-data-extraction-agent':         P2(7),  // practical warrior
  'sales-outreach':                       P1(21), // cunning tiefling
  'accounts-payable-agent':              P1(16), // cleric — precise records
  'data-consolidation-agent':            P2(7),  // practical warrior
  'government-digital-presales-consultant': P1(7), // paladin — authority
  'healthcare-marketing-compliance-specialist': P1(13), // angel — health/care
  'support-responder':                    P1(6),  // charming helpful female

  // ── Specialized ───────────────────────────────────────────────────────────
  'developer-advocate':                   P1(15), // adventurous storyteller
  'document-generator':                   P1(16), // cleric — documents
  'executive-summary-generator':          P1(7),  // commander — executive
  'finance-tracker':                      P1(25), // gunslinger — precise tracking
  'infrastructure-maintainer':            P1(35), // silver knight — maintenance
  'legal-compliance-checker':             P1(8),  // armored knight — compliance
  'civil-engineer':                       P1(35), // silver knight — structural
  'cultural-intelligence-strategist':    P2(2),  // wise elder — cultural
  'french-consulting-market-navigator':  P1(45), // wise elf — navigation
  'korean-business-navigator':           P2(35), // queen — cultural authority
  'supply-chain-strategist':             P1(3),  // explorer — supply chain
  'study-abroad-advisor':                P1(3),  // explorer — travel/study
  'zk-steward':                           P1(17), // ninja — zero knowledge/stealth
  'behavioral-nudge-engine':             P1(21), // cunning tiefling — behavioral
  'feedback-synthesizer':                P2(3),  // focused researcher
  'trend-researcher':                     P1(3),  // explorer — trend hunting
  'workflow-optimizer':                   P1(3),  // explorer — optimizing
};

export function getAgentCharacter(catalogId) {
  return CHARACTERS[catalogId] || '/assets/characters/default.png';
}
