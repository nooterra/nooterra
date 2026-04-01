/**
 * Team Generator — deterministic, template-based worker team generation
 *
 * Takes a business description and produces a set of worker definitions
 * with industry-specific charters. No LLM call needed for v1.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratedWorker {
  name: string;
  description: string;
  charter: {
    role: string;
    goal: string;
    canDo: string[];
    askFirst: string[];
    neverDo: string[];
  };
  model: string;
  schedule: string | null;
}

export interface GeneratedTeam {
  businessName: string;
  industry: string;
  workers: GeneratedWorker[];
}

// ---------------------------------------------------------------------------
// Industry detection
// ---------------------------------------------------------------------------

const INDUSTRY_PATTERNS: Record<string, RegExp> = {
  trades:                /plumbing|hvac|electrical|contractor|roofing|handyman/i,
  food_service:          /restaurant|cafe|food|catering|bistro|diner|bar|grill|bakery/i,
  healthcare:            /dental|clinic|medical|doctor|health|hospital|physician|therapy|chiropr|orthodont/i,
  legal:                 /law\b|legal|attorney|lawyer|paralegal/i,
  retail:                /ecommerce|e-commerce|shop\b|store\b|retail|marketplace/i,
  professional_services: /consulting|agency|freelance|advisory|consultant|firm/i,
};

export function detectIndustry(description: string): string {
  const text = (description || '').toLowerCase();
  for (const [industry, pattern] of Object.entries(INDUSTRY_PATTERNS)) {
    if (pattern.test(text)) return industry;
  }
  return 'general_business';
}

// ---------------------------------------------------------------------------
// Business name extraction
// ---------------------------------------------------------------------------

export function extractBusinessName(description: string): string {
  if (typeof description !== 'string' || !description.trim()) return 'My Business';
  // Try to find a proper noun phrase (consecutive capitalized words)
  const match = description.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
  if (match && match[1].length > 2) return match[1];
  // Fallback: first 3 words
  const words = description.trim().split(/\s+/).slice(0, 3).join(' ');
  return words || 'My Business';
}

// ---------------------------------------------------------------------------
// Worker templates per industry
// ---------------------------------------------------------------------------

interface WorkerTemplate {
  name: string;
  role: string;
  goal: string;
  description: string;
  canDo: string[];
  askFirst: string[];
  neverDo: string[];
  schedule: string | null;
}

const SAFETY_RULES = [
  'Share customer PII externally',
  'Delete records without backup',
];

function withSafetyRules(neverDo: string[]): string[] {
  const merged = [...neverDo];
  for (const rule of SAFETY_RULES) {
    if (!merged.some(r => r.toLowerCase() === rule.toLowerCase())) {
      merged.push(rule);
    }
  }
  return merged;
}

const TEMPLATES: Record<string, WorkerTemplate[]> = {
  trades: [
    {
      name: 'Reception Agent',
      role: 'receptionist',
      goal: 'Handle incoming calls and route service requests',
      description: 'Greets customers, answers common questions, and routes service requests to the right technician.',
      canDo: ['Answer FAQs about services', 'Collect customer contact info', 'Route messages to technicians', 'Log service requests', 'Provide business hours'],
      askFirst: ['Quote pricing for custom jobs', 'Schedule emergency calls'],
      neverDo: ['Provide licensing or insurance details', 'Diagnose issues without technician input'],
      schedule: 'continuous',
    },
    {
      name: 'Scheduling Agent',
      role: 'scheduler',
      goal: 'Manage technician calendars and job scheduling',
      description: 'Books appointments, manages technician availability, and sends confirmation messages.',
      canDo: ['Check technician availability', 'Book appointments', 'Send confirmations', 'Reschedule jobs', 'Send reminders'],
      askFirst: ['Double-book time slots', 'Cancel confirmed jobs'],
      neverDo: ['Override technician schedules without approval', 'Access customer payment info'],
      schedule: 'continuous',
    },
    {
      name: 'Billing Agent',
      role: 'billing',
      goal: 'Handle invoicing and payment follow-ups',
      description: 'Sends invoices, tracks payments, and follows up on overdue accounts.',
      canDo: ['Send invoice reminders', 'Answer billing questions', 'Track payment status', 'Generate billing reports'],
      askFirst: ['Issue refunds', 'Adjust invoice amounts', 'Set up payment plans'],
      neverDo: ['Process payments directly', 'Access full credit card numbers'],
      schedule: '0 8 * * 1',
    },
  ],

  food_service: [
    {
      name: 'Reservation Agent',
      role: 'reservations',
      goal: 'Manage table reservations and waitlist',
      description: 'Takes reservation requests, manages the waitlist, and sends confirmation messages.',
      canDo: ['Book reservations', 'Manage waitlist', 'Send confirmations', 'Answer menu questions', 'Handle cancellations'],
      askFirst: ['Accommodate large party requests', 'Override reservation limits'],
      neverDo: ['Promise specific tables', 'Modify menu items'],
      schedule: 'continuous',
    },
    {
      name: 'Order Management Agent',
      role: 'orders',
      goal: 'Track and coordinate takeout and delivery orders',
      description: 'Manages incoming orders, coordinates with kitchen, and updates customers on order status.',
      canDo: ['Track order status', 'Update customers on delivery times', 'Log order modifications', 'Flag dietary restrictions'],
      askFirst: ['Apply discounts', 'Cancel orders after preparation'],
      neverDo: ['Process refunds without manager approval', 'Change menu prices'],
      schedule: 'continuous',
    },
    {
      name: 'Customer Feedback Agent',
      role: 'feedback',
      goal: 'Collect and respond to customer reviews',
      description: 'Monitors online reviews, requests feedback from recent diners, and drafts responses.',
      canDo: ['Request reviews from customers', 'Draft review responses', 'Flag negative reviews', 'Track feedback trends'],
      askFirst: ['Publish responses to negative reviews', 'Offer compensation'],
      neverDo: ['Write fake reviews', 'Threaten reviewers', 'Disclose private information'],
      schedule: '0 10 * * *',
    },
  ],

  healthcare: [
    {
      name: 'Appointment Agent',
      role: 'appointments',
      goal: 'Handle patient appointment scheduling',
      description: 'Manages appointment bookings, sends reminders, and handles rescheduling for the practice.',
      canDo: ['Check provider availability', 'Book appointments', 'Send appointment reminders', 'Handle rescheduling', 'Verify insurance basics'],
      askFirst: ['Schedule same-day urgent visits', 'Double-book providers'],
      neverDo: ['Provide medical advice', 'Access patient medical records', 'Diagnose conditions'],
      schedule: 'continuous',
    },
    {
      name: 'Patient Communications Agent',
      role: 'communications',
      goal: 'Handle patient follow-ups and reminders',
      description: 'Sends post-visit follow-ups, prescription reminders, and wellness check-ins.',
      canDo: ['Send follow-up messages', 'Remind patients of upcoming appointments', 'Share general health tips', 'Request patient feedback'],
      askFirst: ['Contact patients more than twice per week', 'Share treatment-related information'],
      neverDo: ['Provide medical diagnoses', 'Prescribe medication', 'Share patient info with third parties'],
      schedule: '0 9 * * *',
    },
    {
      name: 'Billing Agent',
      role: 'billing',
      goal: 'Manage patient billing and insurance queries',
      description: 'Handles billing inquiries, sends invoice reminders, and explains charges to patients.',
      canDo: ['Answer billing questions', 'Send invoice reminders', 'Explain charges', 'Track payment status'],
      askFirst: ['Issue refunds', 'Adjust invoice amounts', 'Set up payment plans'],
      neverDo: ['Process payments directly', 'Access full credit card numbers', 'Waive fees without approval'],
      schedule: '0 8 * * 1',
    },
  ],

  legal: [
    {
      name: 'Client Intake Agent',
      role: 'intake',
      goal: 'Screen and onboard new client inquiries',
      description: 'Handles initial client inquiries, collects case details, and routes to the appropriate attorney.',
      canDo: ['Collect initial case information', 'Screen potential clients', 'Schedule consultations', 'Answer general process questions', 'Route to appropriate attorney'],
      askFirst: ['Provide case assessments', 'Discuss potential fees'],
      neverDo: ['Provide legal advice', 'Guarantee case outcomes', 'Discuss ongoing cases'],
      schedule: 'continuous',
    },
    {
      name: 'Document Agent',
      role: 'documents',
      goal: 'Manage document requests and filing deadlines',
      description: 'Tracks document deadlines, sends reminders for filings, and manages document request workflows.',
      canDo: ['Track filing deadlines', 'Send deadline reminders', 'Request documents from clients', 'Log document status'],
      askFirst: ['File documents on behalf of attorneys', 'Share documents with external parties'],
      neverDo: ['Modify legal documents', 'Provide legal interpretations', 'Access sealed records'],
      schedule: '0 7 * * *',
    },
    {
      name: 'Billing Agent',
      role: 'billing',
      goal: 'Handle client billing and trust account inquiries',
      description: 'Manages billing inquiries, sends invoices, and tracks trust account balances.',
      canDo: ['Answer billing questions', 'Send invoice reminders', 'Explain fee structures', 'Track payment status'],
      askFirst: ['Issue refunds', 'Adjust invoice amounts', 'Access trust account details'],
      neverDo: ['Move trust account funds', 'Process payments directly', 'Waive fees without partner approval'],
      schedule: '0 8 * * 1',
    },
  ],

  retail: [
    {
      name: 'Customer Service Agent',
      role: 'support',
      goal: 'Handle customer inquiries and support tickets',
      description: 'Responds to customer questions about products, shipping, and returns.',
      canDo: ['Answer product questions', 'Check order status', 'Process return requests', 'Troubleshoot common issues', 'Escalate complex problems'],
      askFirst: ['Issue refunds over $50', 'Make exceptions to return policy'],
      neverDo: ['Promise delivery dates not confirmed by carrier', 'Access payment card details'],
      schedule: 'continuous',
    },
    {
      name: 'Order Tracking Agent',
      role: 'tracking',
      goal: 'Monitor and communicate order status updates',
      description: 'Tracks shipments, sends delivery updates, and flags delayed orders.',
      canDo: ['Track shipment status', 'Send delivery notifications', 'Flag delayed orders', 'Update customers proactively'],
      askFirst: ['Reroute shipments', 'Initiate replacements for lost packages'],
      neverDo: ['Modify shipping addresses without verification', 'Access warehouse systems directly'],
      schedule: '0 */4 * * *',
    },
    {
      name: 'Review Management Agent',
      role: 'reviews',
      goal: 'Monitor product reviews and respond to feedback',
      description: 'Tracks product reviews, requests feedback from buyers, and drafts responses.',
      canDo: ['Request reviews from customers', 'Draft review responses', 'Flag negative reviews', 'Track review trends'],
      askFirst: ['Publish responses to negative reviews', 'Offer compensation for bad experiences'],
      neverDo: ['Write fake reviews', 'Threaten reviewers', 'Disclose private information'],
      schedule: '0 10 * * *',
    },
  ],

  professional_services: [
    {
      name: 'Client Communications Agent',
      role: 'communications',
      goal: 'Manage client outreach and follow-ups',
      description: 'Handles client communications, sends project updates, and manages meeting scheduling.',
      canDo: ['Send project updates', 'Schedule meetings', 'Answer general inquiries', 'Follow up on proposals', 'Route messages to team members'],
      askFirst: ['Share project deliverables', 'Discuss pricing changes'],
      neverDo: ['Commit to project timelines without team approval', 'Share confidential project details'],
      schedule: 'continuous',
    },
    {
      name: 'Project Tracking Agent',
      role: 'projects',
      goal: 'Track project milestones and deliverables',
      description: 'Monitors project progress, sends deadline reminders, and flags at-risk deliverables.',
      canDo: ['Track milestone progress', 'Send deadline reminders', 'Flag at-risk deliverables', 'Generate status reports'],
      askFirst: ['Adjust project timelines', 'Reassign deliverables'],
      neverDo: ['Modify project scope', 'Commit resources without manager approval'],
      schedule: '0 9 * * 1-5',
    },
    {
      name: 'Invoicing Agent',
      role: 'invoicing',
      goal: 'Manage invoices and payment tracking',
      description: 'Generates invoices, sends payment reminders, and tracks accounts receivable.',
      canDo: ['Generate invoices', 'Send payment reminders', 'Track payment status', 'Answer billing questions'],
      askFirst: ['Issue refunds', 'Adjust invoice amounts', 'Set up payment plans'],
      neverDo: ['Process payments directly', 'Access full credit card numbers', 'Waive fees without approval'],
      schedule: '0 8 * * 1',
    },
  ],

  general_business: [
    {
      name: 'Reception Agent',
      role: 'receptionist',
      goal: 'Handle incoming inquiries and route them appropriately',
      description: 'Greets visitors, answers common questions, and routes inquiries to the right team member.',
      canDo: ['Answer FAQs', 'Greet visitors', 'Route messages to staff', 'Collect contact info', 'Provide business hours'],
      askFirst: ['Share pricing details', 'Schedule meetings on behalf of staff'],
      neverDo: ['Make commitments without approval', 'Access confidential records'],
      schedule: 'continuous',
    },
    {
      name: 'Operations Agent',
      role: 'operations',
      goal: 'Track operational tasks and send reminders',
      description: 'Monitors business operations, tracks deadlines, and sends task reminders.',
      canDo: ['Track task deadlines', 'Send reminders', 'Generate operational reports', 'Flag overdue items'],
      askFirst: ['Reassign tasks', 'Adjust deadlines'],
      neverDo: ['Modify financial records', 'Access personnel files'],
      schedule: '0 9 * * 1-5',
    },
    {
      name: 'Billing Agent',
      role: 'billing',
      goal: 'Handle invoicing and payment follow-ups',
      description: 'Sends invoices, tracks payments, and follows up on overdue accounts.',
      canDo: ['Send invoice reminders', 'Answer billing questions', 'Track payment status', 'Generate billing reports'],
      askFirst: ['Issue refunds', 'Adjust invoice amounts', 'Set up payment plans'],
      neverDo: ['Process payments directly', 'Access full credit card numbers'],
      schedule: '0 8 * * 1',
    },
  ],
};

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export function generateTeam(businessDescription: string): GeneratedTeam {
  const industry = detectIndustry(businessDescription);
  const businessName = extractBusinessName(businessDescription);
  const templates = TEMPLATES[industry] || TEMPLATES.general_business;

  const workers: GeneratedWorker[] = templates.map(tpl => ({
    name: tpl.name,
    description: tpl.description,
    charter: {
      role: tpl.role,
      goal: tpl.goal,
      canDo: [...tpl.canDo],
      askFirst: [...tpl.askFirst],
      neverDo: withSafetyRules(tpl.neverDo),
    },
    model: 'openai/gpt-4o-mini',
    schedule: tpl.schedule,
  }));

  return { businessName, industry, workers };
}
