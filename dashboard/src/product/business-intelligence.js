// ─────────────────────────────────────────────────────────────────────────────
// business-intelligence.js
//
// Deterministic pattern-matching engine that turns a plain-text business
// description into a proposed AI worker team, integrations list, and ROI
// estimate.  No LLM, no API calls — pure keyword matching + structured data.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Industry taxonomy ───────────────────────────────────────────────────────

const INDUSTRY_TAXONOMY = Object.freeze({
  home_services: {
    label: "Home Services",
    keywords: [
      "plumbing", "plumber", "electrical", "electrician", "hvac",
      "heating", "cooling", "air conditioning", "landscaping", "landscaper",
      "lawn care", "cleaning", "maid", "janitorial", "pest control",
      "exterminator", "roofing", "roofer", "handyman", "home repair",
      "garage door", "locksmith", "pressure washing", "gutter",
      "appliance repair", "pool service", "septic", "drain",
    ],
    subIndustries: {
      plumbing: ["plumbing", "plumber", "pipe", "drain", "septic", "water heater"],
      electrical: ["electrical", "electrician", "wiring", "lighting"],
      hvac: ["hvac", "heating", "cooling", "air conditioning", "furnace"],
      landscaping: ["landscaping", "landscaper", "lawn", "mowing", "tree service"],
      cleaning: ["cleaning", "maid", "janitorial", "housekeeping", "pressure washing"],
      pest_control: ["pest control", "exterminator", "termite", "bug"],
      roofing: ["roofing", "roofer", "roof repair", "shingle"],
    },
  },
  restaurant: {
    label: "Restaurant & Food",
    keywords: [
      "restaurant", "cafe", "coffee shop", "bar", "pub", "brewery",
      "bakery", "pizzeria", "food truck", "catering", "diner",
      "bistro", "grill", "sushi", "taco", "burger", "kitchen",
      "fast food", "fast casual", "fine dining", "buffet",
    ],
    subIndustries: {
      restaurant: ["restaurant", "diner", "bistro", "grill", "fine dining"],
      cafe: ["cafe", "coffee shop", "coffee"],
      bar: ["bar", "pub", "brewery", "taproom"],
      bakery: ["bakery", "pastry", "cake"],
      food_truck: ["food truck"],
      catering: ["catering", "caterer", "event food"],
    },
  },
  retail: {
    label: "Retail",
    keywords: [
      "store", "shop", "boutique", "retail", "gift shop",
      "clothing store", "hardware store", "convenience store",
      "liquor store", "pet store", "toy store", "bookstore",
      "thrift store", "consignment", "showroom",
    ],
    subIndustries: {
      clothing: ["clothing", "apparel", "fashion", "boutique"],
      general: ["store", "shop", "retail", "gift shop"],
      specialty: ["hardware store", "pet store", "toy store", "bookstore"],
    },
  },
  ecommerce: {
    label: "E-Commerce",
    keywords: [
      "online store", "ecommerce", "e-commerce", "shopify", "etsy",
      "amazon seller", "amazon fba", "ebay", "woocommerce",
      "dropshipping", "online shop", "web store", "online retail",
      "direct to consumer", "d2c", "dtc", "subscription box",
    ],
    subIndustries: {
      marketplace: ["amazon seller", "amazon fba", "ebay", "etsy"],
      own_store: ["shopify", "woocommerce", "online store", "web store"],
      dropshipping: ["dropshipping", "drop ship"],
    },
  },
  professional_services: {
    label: "Professional Services",
    keywords: [
      "law firm", "lawyer", "attorney", "legal", "accounting",
      "accountant", "cpa", "bookkeeper", "bookkeeping", "consulting",
      "consultant", "financial advisor", "financial planner",
      "insurance", "insurance agency", "tax preparation", "tax prep",
      "notary", "hr consulting", "management consulting",
    ],
    subIndustries: {
      legal: ["law firm", "lawyer", "attorney", "legal"],
      accounting: ["accounting", "accountant", "cpa", "bookkeeper", "bookkeeping", "tax preparation", "tax prep"],
      consulting: ["consulting", "consultant", "management consulting"],
      financial: ["financial advisor", "financial planner", "wealth management"],
      insurance: ["insurance", "insurance agency", "insurance broker"],
    },
  },
  healthcare: {
    label: "Healthcare",
    keywords: [
      "dental", "dentist", "clinic", "medical clinic", "therapy",
      "therapist", "chiropractic", "chiropractor", "veterinary",
      "vet", "veterinarian", "optometry", "optometrist", "eye doctor",
      "physical therapy", "occupational therapy", "mental health",
      "counselor", "psychiatrist", "dermatology", "podiatry",
      "urgent care", "home health", "pharmacy", "orthodontist",
    ],
    subIndustries: {
      dental: ["dental", "dentist", "orthodontist"],
      medical: ["clinic", "medical clinic", "urgent care", "physician"],
      therapy: ["therapy", "therapist", "physical therapy", "occupational therapy", "mental health", "counselor"],
      chiropractic: ["chiropractic", "chiropractor"],
      veterinary: ["veterinary", "vet", "veterinarian", "animal hospital"],
      optometry: ["optometry", "optometrist", "eye doctor"],
    },
  },
  real_estate: {
    label: "Real Estate",
    keywords: [
      "real estate", "property management", "realtor", "real estate agent",
      "broker", "property manager", "apartment complex", "rental property",
      "leasing", "commercial real estate", "residential real estate",
      "title company", "home staging", "home inspector",
    ],
    subIndustries: {
      brokerage: ["realtor", "real estate agent", "broker", "real estate"],
      property_management: ["property management", "property manager", "apartment complex", "rental property", "leasing"],
      ancillary: ["title company", "home staging", "home inspector"],
    },
  },
  automotive: {
    label: "Automotive",
    keywords: [
      "auto repair", "mechanic", "auto shop", "car repair",
      "dealership", "car dealership", "used cars", "car wash",
      "detailing", "auto detailing", "tire shop", "body shop",
      "oil change", "transmission", "brake shop", "muffler",
      "towing", "auto parts",
    ],
    subIndustries: {
      repair: ["auto repair", "mechanic", "auto shop", "car repair", "brake shop", "oil change"],
      dealership: ["dealership", "car dealership", "used cars"],
      car_wash: ["car wash", "detailing", "auto detailing"],
      body_shop: ["body shop", "collision repair"],
    },
  },
  fitness: {
    label: "Fitness & Wellness",
    keywords: [
      "gym", "fitness", "yoga", "yoga studio", "personal training",
      "personal trainer", "crossfit", "martial arts", "dance studio",
      "pilates", "boxing", "spinning", "fitness studio",
      "boot camp", "wellness center", "health club",
    ],
    subIndustries: {
      gym: ["gym", "fitness", "health club", "crossfit"],
      yoga: ["yoga", "yoga studio", "pilates"],
      personal_training: ["personal training", "personal trainer", "boot camp"],
      martial_arts: ["martial arts", "karate", "jiu jitsu", "boxing"],
      dance: ["dance studio", "dance"],
    },
  },
  beauty: {
    label: "Beauty & Personal Care",
    keywords: [
      "salon", "hair salon", "barbershop", "barber", "spa",
      "nail salon", "nails", "tattoo", "tattoo shop", "med spa",
      "aesthetics", "lash", "brow", "waxing", "tanning",
      "beauty salon", "makeup artist", "cosmetology",
    ],
    subIndustries: {
      salon: ["salon", "hair salon", "beauty salon", "cosmetology"],
      barbershop: ["barbershop", "barber"],
      spa: ["spa", "med spa", "day spa", "massage"],
      nails: ["nail salon", "nails", "manicure", "pedicure"],
      tattoo: ["tattoo", "tattoo shop", "body art"],
    },
  },
  construction: {
    label: "Construction",
    keywords: [
      "contractor", "general contractor", "builder", "remodeling",
      "renovation", "construction", "framing", "concrete",
      "demolition", "excavation", "home builder", "commercial construction",
      "drywall", "flooring", "painting contractor", "tile",
      "masonry", "welding", "steel", "paving",
    ],
    subIndustries: {
      general: ["contractor", "general contractor", "builder", "construction"],
      remodeling: ["remodeling", "renovation", "kitchen remodel", "bathroom remodel"],
      specialty: ["concrete", "drywall", "flooring", "painting contractor", "tile", "masonry"],
    },
  },
  trucking: {
    label: "Trucking & Logistics",
    keywords: [
      "trucking", "freight", "logistics", "delivery", "courier",
      "shipping", "hauling", "moving company", "movers",
      "dispatch", "fleet", "cdl", "semi", "long haul",
      "last mile", "supply chain", "warehouse", "distribution",
    ],
    subIndustries: {
      trucking: ["trucking", "freight", "hauling", "long haul", "cdl", "semi"],
      delivery: ["delivery", "courier", "last mile"],
      moving: ["moving company", "movers"],
      logistics: ["logistics", "supply chain", "warehouse", "distribution"],
    },
  },
  education: {
    label: "Education & Training",
    keywords: [
      "tutoring", "tutor", "school", "private school", "training",
      "coaching", "life coach", "business coach", "driving school",
      "music lessons", "art lessons", "preschool", "daycare",
      "childcare", "montessori", "learning center", "test prep",
      "language school", "online course",
    ],
    subIndustries: {
      tutoring: ["tutoring", "tutor", "test prep", "learning center"],
      school: ["school", "private school", "preschool", "montessori"],
      coaching: ["coaching", "life coach", "business coach"],
      childcare: ["daycare", "childcare", "after school"],
      lessons: ["music lessons", "art lessons", "driving school", "language school"],
    },
  },
  tech: {
    label: "Technology",
    keywords: [
      "software", "saas", "app", "startup", "agency", "web development",
      "web design", "it services", "managed services", "msp",
      "cybersecurity", "data analytics", "ai", "machine learning",
      "mobile app", "development", "devops", "cloud",
    ],
    subIndustries: {
      software: ["software", "saas", "app", "mobile app"],
      agency: ["agency", "web development", "web design", "digital agency"],
      it_services: ["it services", "managed services", "msp", "cybersecurity"],
      startup: ["startup"],
    },
  },
  hospitality: {
    label: "Hospitality",
    keywords: [
      "hotel", "motel", "airbnb", "vacation rental", "inn",
      "bed and breakfast", "resort", "lodge", "hostel",
      "event venue", "wedding venue", "banquet hall",
      "conference center", "short term rental",
    ],
    subIndustries: {
      hotel: ["hotel", "motel", "inn", "bed and breakfast", "resort", "lodge"],
      vacation_rental: ["airbnb", "vacation rental", "short term rental"],
      venue: ["event venue", "wedding venue", "banquet hall", "conference center"],
    },
  },
  creative: {
    label: "Creative Services",
    keywords: [
      "photography", "photographer", "videography", "videographer",
      "design", "graphic design", "marketing agency", "advertising",
      "branding", "social media", "content creation", "printing",
      "print shop", "sign shop", "recording studio", "production",
      "copywriting", "public relations", "pr agency",
    ],
    subIndustries: {
      photography: ["photography", "photographer"],
      video: ["videography", "videographer", "production", "recording studio"],
      design: ["design", "graphic design", "branding"],
      marketing: ["marketing agency", "advertising", "social media", "content creation", "pr agency"],
      print: ["printing", "print shop", "sign shop"],
    },
  },
  nonprofit: {
    label: "Nonprofit",
    keywords: [
      "nonprofit", "non-profit", "charity", "foundation",
      "501c3", "501(c)(3)", "ngo", "community organization",
      "social enterprise", "mission-driven", "volunteer",
      "fundraising", "grant", "church", "ministry",
    ],
    subIndustries: {
      charity: ["charity", "foundation", "501c3", "501(c)(3)", "ngo"],
      community: ["community organization", "social enterprise"],
      religious: ["church", "ministry", "temple", "mosque", "synagogue"],
    },
  },
  agriculture: {
    label: "Agriculture",
    keywords: [
      "farm", "farmer", "ranch", "rancher", "nursery", "greenhouse",
      "vineyard", "winery", "orchard", "dairy", "livestock",
      "crop", "organic farm", "agribusiness", "feed store",
      "grain", "harvest",
    ],
    subIndustries: {
      farm: ["farm", "farmer", "crop", "organic farm", "grain", "harvest"],
      ranch: ["ranch", "rancher", "livestock", "dairy", "cattle"],
      nursery: ["nursery", "greenhouse"],
      vineyard: ["vineyard", "winery", "orchard"],
    },
  },
});


// ─── Common US cities for location extraction ────────────────────────────────

const US_CITIES = [
  "New York", "Los Angeles", "Chicago", "Houston", "Phoenix",
  "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose",
  "Austin", "Jacksonville", "Fort Worth", "Columbus", "Charlotte",
  "Indianapolis", "San Francisco", "Seattle", "Denver", "Nashville",
  "Oklahoma City", "El Paso", "Boston", "Portland", "Las Vegas",
  "Memphis", "Louisville", "Baltimore", "Milwaukee", "Albuquerque",
  "Tucson", "Fresno", "Mesa", "Sacramento", "Atlanta", "Kansas City",
  "Colorado Springs", "Omaha", "Raleigh", "Miami", "Minneapolis",
  "Tampa", "Tulsa", "Cleveland", "Pittsburgh", "Cincinnati",
  "St. Louis", "Orlando", "Richmond", "Boise", "Des Moines",
  "Salt Lake City", "Honolulu", "Anchorage", "Birmingham", "Spokane",
  "Rochester", "Madison", "Knoxville", "Chattanooga", "Savannah",
  "Charleston", "Asheville", "Santa Fe", "Scottsdale", "Naperville",
  "Ann Arbor", "Boulder", "Provo", "Lexington", "Pensacola",
];

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California",
  "Colorado", "Connecticut", "Delaware", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
  "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri",
  "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

const STATE_ABBREVIATIONS = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];


// ─── Size keywords ───────────────────────────────────────────────────────────

const SIZE_KEYWORDS = [
  "employee", "employees", "people", "person", "team members",
  "staff", "workers", "technicians", "techs", "drivers",
  "agents", "stylists", "therapists", "mechanics", "guys",
  "members", "contractors", "crew", "associates",
];


// ─── Industry-specific worker templates ──────────────────────────────────────

const TEAM_TEMPLATES = Object.freeze({
  home_services: [
    {
      role: "Reception",
      title: "Phone & Scheduling Coordinator",
      description: "Answers calls and emails, books service appointments, and handles basic questions about your services, service area, and availability.",
      canDo: [
        "Answer incoming calls and route urgent ones to on-call tech",
        "Respond to email and web form inquiries within 15 minutes",
        "Book and confirm service appointments",
        "Provide service area, hours, and basic pricing info",
        "Send appointment reminders 24 hours in advance",
        "Reschedule or cancel appointments per your policy",
      ],
      askFirst: [
        "Schedule same-day emergency jobs",
        "Quote jobs estimated above $500",
        "Offer discounts or promotional rates",
        "Book outside normal service area",
      ],
      neverDo: [
        "Share other customers' personal information",
        "Make guarantees about exact arrival times",
        "Accept payments over the phone without verification",
        "Diagnose technical problems remotely",
      ],
      schedule: "continuous",
      integrations: ["phone", "email", "calendar"],
    },
    {
      role: "Dispatch",
      title: "Job Dispatch & Routing",
      description: "Assigns incoming jobs to available technicians based on location, skill, and schedule. Keeps the day running efficiently.",
      canDo: [
        "Assign jobs to the nearest available tech",
        "Re-route techs when a job runs long or cancels",
        "Send customers real-time ETA updates",
        "Track technician locations during work hours",
        "Flag scheduling conflicts before they happen",
        "Maintain a waitlist for fully-booked days",
      ],
      askFirst: [
        "Reassign a job mid-service to a different tech",
        "Schedule overtime or weekend work",
        "Dispatch to a job outside the service area",
      ],
      neverDo: [
        "Cancel a job without notifying the customer",
        "Share technician personal phone numbers with customers",
        "Override a tech's day-off without manager approval",
      ],
      schedule: "business_hours",
      integrations: ["calendar", "maps", "sms"],
    },
    {
      role: "Billing",
      title: "Invoicing & Payment Follow-up",
      description: "Creates and sends invoices after job completion, tracks payments, and follows up on outstanding balances.",
      canDo: [
        "Generate invoices from completed job tickets",
        "Send invoices via email with online payment links",
        "Send payment reminders at 7, 14, and 30 days overdue",
        "Record payments received and mark invoices as paid",
        "Generate weekly accounts receivable summary",
        "Apply standard service rates from your price list",
      ],
      askFirst: [
        "Offer a payment plan on large invoices",
        "Write off an invoice as uncollectable",
        "Apply a discount after the invoice is sent",
        "Send a final collections notice",
      ],
      neverDo: [
        "Change pricing without authorization",
        "Share financial information with third parties",
        "Process refunds without manager approval",
        "Store credit card numbers in plain text",
      ],
      schedule: "business_hours",
      integrations: ["accounting", "email", "payments"],
    },
    {
      role: "Reviews",
      title: "Reputation & Review Manager",
      description: "Requests reviews from happy customers, monitors review platforms, and drafts responses to both positive and negative reviews.",
      canDo: [
        "Send review request texts/emails 2 hours after job completion",
        "Monitor Google, Yelp, and Facebook for new reviews",
        "Draft personalized thank-you responses to positive reviews",
        "Draft professional responses to negative reviews for your approval",
        "Track review volume and average rating weekly",
        "Flag reviews that mention specific issues for follow-up",
      ],
      askFirst: [
        "Publish a response to a 1-star review",
        "Offer a discount to resolve a negative review",
        "Report a review as fraudulent",
      ],
      neverDo: [
        "Post fake reviews or incentivize reviews with payment",
        "Argue with customers in public review responses",
        "Ignore negative reviews for more than 48 hours",
        "Share details of other jobs in a review response",
      ],
      schedule: "business_hours",
      integrations: ["reviews", "sms", "email"],
    },
    {
      role: "Inventory",
      title: "Parts & Supply Tracker",
      description: "Tracks inventory of common parts and supplies, flags when stock is low, and helps generate purchase orders.",
      canDo: [
        "Track inventory counts for your most-used parts",
        "Send low-stock alerts when items hit reorder thresholds",
        "Generate purchase order drafts for common suppliers",
        "Log parts used per job for cost tracking",
        "Provide monthly inventory usage reports",
      ],
      askFirst: [
        "Place a purchase order above $1,000",
        "Switch to an alternate supplier",
        "Order specialty or non-standard parts",
      ],
      neverDo: [
        "Approve purchases without budget review",
        "Share supplier pricing with competitors",
        "Discard inventory records",
      ],
      schedule: "business_hours",
      integrations: ["inventory", "email"],
    },
    {
      role: "Marketing",
      title: "Local Marketing & Leads",
      description: "Manages your online presence, posts seasonal promotions, and follows up on new leads from your website and social media.",
      canDo: [
        "Post service tips and seasonal reminders to social media weekly",
        "Respond to Facebook and Instagram DMs about services",
        "Follow up on website contact form submissions within 30 minutes",
        "Update your Google Business Profile hours and photos",
        "Send seasonal email campaigns to past customers",
      ],
      askFirst: [
        "Launch a paid ad campaign",
        "Offer a promotion or coupon",
        "Partner with another local business for cross-promotion",
      ],
      neverDo: [
        "Guarantee results from marketing spend",
        "Post photos of customers' homes without permission",
        "Make claims about services you don't offer",
      ],
      schedule: "business_hours",
      integrations: ["social_media", "email", "website"],
    },
  ],

  restaurant: [
    {
      role: "Reservations",
      title: "Reservation & Waitlist Manager",
      description: "Handles reservation requests by phone, email, and online platforms. Manages the waitlist during peak hours and sends confirmations.",
      canDo: [
        "Accept and confirm reservations up to 30 days out",
        "Manage walk-in waitlist and send table-ready notifications",
        "Handle reservation modifications and cancellations",
        "Note dietary restrictions and special occasion requests",
        "Send reservation confirmations and day-of reminders",
        "Track no-show rates and flag repeat offenders",
      ],
      askFirst: [
        "Accept a party larger than 10",
        "Book a private dining event",
        "Override a fully-booked time slot",
        "Apply a cancellation fee",
      ],
      neverDo: [
        "Overbook beyond safe capacity limits",
        "Share customer dining history with third parties",
        "Promise specific tables without manager approval",
      ],
      schedule: "continuous",
      integrations: ["phone", "email", "reservations"],
    },
    {
      role: "Orders",
      title: "Online Order & Delivery Coordinator",
      description: "Manages incoming orders from delivery platforms and your own online ordering, ensures accuracy, and coordinates with the kitchen.",
      canDo: [
        "Monitor and accept incoming online orders",
        "Verify order accuracy before confirming",
        "Update estimated pickup and delivery times",
        "Pause online ordering when the kitchen is backed up",
        "Handle order modifications before preparation begins",
        "Track order volume by platform and time of day",
      ],
      askFirst: [
        "Issue a full refund on a delivered order",
        "Disable a menu item across all platforms",
        "Accept a large catering order through online ordering",
      ],
      neverDo: [
        "Accept orders for items not on the current menu",
        "Override food safety hold times",
        "Share customer order data with competing restaurants",
      ],
      schedule: "business_hours",
      integrations: ["pos", "delivery_platforms", "sms"],
    },
    {
      role: "Reviews",
      title: "Guest Feedback & Review Manager",
      description: "Monitors reviews across Google, Yelp, and delivery apps. Responds to feedback and identifies recurring issues for the team.",
      canDo: [
        "Monitor all review platforms daily for new reviews",
        "Respond to positive reviews with personalized thanks",
        "Draft responses to negative reviews for manager approval",
        "Track review trends and recurring complaints weekly",
        "Follow up privately with unhappy guests to offer resolution",
        "Compile a weekly feedback summary for the management team",
      ],
      askFirst: [
        "Offer a complimentary meal to resolve a complaint",
        "Respond publicly to a health or safety complaint",
        "Report a review as fraudulent",
      ],
      neverDo: [
        "Argue with reviewers in public responses",
        "Disclose details about staff or internal operations",
        "Offer compensation exceeding policy limits",
      ],
      schedule: "business_hours",
      integrations: ["reviews", "email", "sms"],
    },
    {
      role: "Inventory",
      title: "Food & Supply Inventory Manager",
      description: "Tracks ingredient stock levels, flags items nearing expiration, and generates purchase orders for regular suppliers.",
      canDo: [
        "Track daily inventory counts for high-turnover items",
        "Send low-stock alerts before service begins",
        "Generate standing purchase orders for regular deliveries",
        "Flag items approaching expiration dates",
        "Track food cost ratios per menu category",
        "Log waste and comp items daily",
      ],
      askFirst: [
        "Place an order with a new supplier",
        "Order specialty ingredients above $500",
        "Switch brands on a core ingredient",
      ],
      neverDo: [
        "Accept deliveries without quality inspection notes",
        "Override food safety expiration protocols",
        "Approve purchases beyond weekly budget without authorization",
      ],
      schedule: "business_hours",
      integrations: ["inventory", "accounting", "email"],
    },
    {
      role: "Staff",
      title: "Staff Scheduling & Communication",
      description: "Manages shift schedules, handles swap requests, sends shift reminders, and tracks time-off requests.",
      canDo: [
        "Build and publish weekly shift schedules",
        "Send shift reminders 12 hours before each shift",
        "Process shift swap requests between team members",
        "Track time-off requests and maintain a coverage calendar",
        "Alert management when a shift is understaffed",
        "Maintain an on-call list for last-minute coverage",
      ],
      askFirst: [
        "Approve overtime shifts",
        "Schedule a minor outside legal work-hour limits",
        "Approve time-off during peak periods (holidays, events)",
      ],
      neverDo: [
        "Share employee pay rates or personal information with other staff",
        "Schedule shifts that violate labor law rest requirements",
        "Deny time-off requests without manager review",
      ],
      schedule: "business_hours",
      integrations: ["scheduling", "sms", "email"],
    },
    {
      role: "Marketing",
      title: "Social Media & Promotions",
      description: "Posts daily specials, manages social media presence, promotes events, and drives traffic during slow periods.",
      canDo: [
        "Post daily specials and behind-the-scenes content to social media",
        "Respond to comments and DMs on social platforms",
        "Create and schedule promotional posts for upcoming events",
        "Send email campaigns to your subscriber list",
        "Update hours and photos on Google Business Profile",
      ],
      askFirst: [
        "Run a paid social media campaign",
        "Partner with a food influencer or blogger",
        "Announce a new menu or price change",
      ],
      neverDo: [
        "Post photos of guests without their consent",
        "Make health claims about menu items",
        "Respond to public health department inquiries on social media",
      ],
      schedule: "business_hours",
      integrations: ["social_media", "email", "website"],
    },
  ],

  professional_services: [
    {
      role: "Intake",
      title: "Client Intake Coordinator",
      description: "Handles initial client inquiries, collects preliminary information, screens for conflicts, and schedules consultations.",
      canDo: [
        "Answer incoming calls and emails from prospective clients",
        "Collect basic case or project information via intake forms",
        "Screen inquiries for practice area or service fit",
        "Schedule initial consultations and send confirmation details",
        "Send new-client welcome packets with required documents",
        "Follow up with prospects who started but didn't complete intake",
      ],
      askFirst: [
        "Schedule a consultation outside normal business hours",
        "Accept a case type outside your usual practice areas",
        "Waive or reduce consultation fees",
        "Fast-track an intake for an urgent matter",
      ],
      neverDo: [
        "Provide legal, financial, or professional advice",
        "Promise case outcomes or guaranteed results",
        "Share client information between unrelated matters",
        "Accept retainers or payments without proper documentation",
      ],
      schedule: "business_hours",
      integrations: ["phone", "email", "calendar", "crm"],
    },
    {
      role: "Scheduling",
      title: "Calendar & Meeting Manager",
      description: "Manages calendars for all professionals, coordinates meetings with clients, and handles rescheduling.",
      canDo: [
        "Schedule client meetings and internal conferences",
        "Send meeting confirmations with prep materials attached",
        "Handle rescheduling requests and find alternative times",
        "Send reminders 24 hours and 1 hour before meetings",
        "Block focus time for professionals when requested",
        "Coordinate multi-party meetings across time zones",
      ],
      askFirst: [
        "Double-book a time slot for an urgent matter",
        "Schedule meetings outside business hours",
        "Cancel a long-standing recurring meeting",
      ],
      neverDo: [
        "Move client meetings without notifying all parties",
        "Share one client's schedule with another client",
        "Delete calendar entries without confirmation",
      ],
      schedule: "business_hours",
      integrations: ["calendar", "email", "video_conferencing"],
    },
    {
      role: "Documents",
      title: "Document Preparation & Filing",
      description: "Prepares standard documents from templates, tracks filing deadlines, and organizes client files.",
      canDo: [
        "Generate standard documents from approved templates",
        "Track filing deadlines and send advance warnings",
        "Organize incoming documents into the correct client files",
        "Prepare document packages for client signatures",
        "Maintain a checklist of required documents per matter",
        "Convert and format documents to required specifications",
      ],
      askFirst: [
        "File documents with courts or regulatory bodies",
        "Modify language in a standard template",
        "Send documents to opposing parties or third parties",
      ],
      neverDo: [
        "Draft custom legal or financial documents without review",
        "Send documents to wrong parties",
        "Delete or modify filed documents retroactively",
        "Provide interpretation of document contents to clients",
      ],
      schedule: "business_hours",
      integrations: ["document_management", "email", "e_signature"],
    },
    {
      role: "Billing",
      title: "Billing & Collections",
      description: "Tracks billable time, generates invoices, processes payments, and follows up on outstanding accounts.",
      canDo: [
        "Compile billable hours and expenses into invoices",
        "Send monthly invoices to clients with payment links",
        "Track retainer balances and send replenishment notices",
        "Send payment reminders at 15, 30, and 45 days overdue",
        "Generate monthly revenue and collections reports",
        "Record and reconcile incoming payments",
      ],
      askFirst: [
        "Offer a payment plan or adjust billing terms",
        "Write off an outstanding balance",
        "Apply a retroactive rate adjustment",
        "Escalate to formal collections",
      ],
      neverDo: [
        "Modify billing rates without authorization",
        "Share billing details between clients",
        "Apply trust or escrow funds without proper authorization",
        "Delete billing records",
      ],
      schedule: "business_hours",
      integrations: ["accounting", "email", "payments", "time_tracking"],
    },
    {
      role: "Follow-ups",
      title: "Client Follow-up & Nurture",
      description: "Stays in touch with past and current clients through check-ins, case updates, and referral requests.",
      canDo: [
        "Send periodic case or project status updates to clients",
        "Follow up with past clients at 3, 6, and 12 months",
        "Request referrals and testimonials from satisfied clients",
        "Send relevant newsletters or legal/industry updates",
        "Track client satisfaction and flag dissatisfied clients",
        "Maintain a client relationship timeline",
      ],
      askFirst: [
        "Re-engage a client who previously filed a complaint",
        "Send communications about new service offerings",
        "Share case studies referencing real client outcomes",
      ],
      neverDo: [
        "Solicit clients in ways that violate professional ethics rules",
        "Share confidential case details in marketing materials",
        "Provide advice in follow-up communications",
      ],
      schedule: "business_hours",
      integrations: ["email", "crm", "sms"],
    },
  ],

  ecommerce: [
    {
      role: "Support",
      title: "Customer Support Agent",
      description: "Handles customer inquiries about orders, products, and policies. Resolves issues quickly to keep satisfaction high.",
      canDo: [
        "Answer questions about products, sizing, and specifications",
        "Look up order status and provide tracking information",
        "Process simple exchanges for different sizes or colors",
        "Answer questions about shipping times and return policies",
        "Escalate technical product issues to the right team",
        "Maintain FAQ responses and canned reply library",
      ],
      askFirst: [
        "Issue a refund above $100",
        "Send a replacement product without return of original",
        "Offer a discount code to resolve a complaint",
        "Override the standard return window",
      ],
      neverDo: [
        "Share customer data with third parties",
        "Make promises about product capabilities not in specs",
        "Process chargebacks without documentation",
        "Give medical, legal, or safety advice about products",
      ],
      schedule: "continuous",
      integrations: ["email", "chat", "helpdesk"],
    },
    {
      role: "Orders",
      title: "Order Tracking & Fulfillment Monitor",
      description: "Monitors order flow from purchase through delivery. Catches stuck orders, shipping delays, and fulfillment errors before customers notice.",
      canDo: [
        "Monitor all orders for fulfillment delays",
        "Flag orders stuck in processing for more than 24 hours",
        "Proactively notify customers about shipping delays",
        "Track carrier performance and delivery success rates",
        "Generate daily fulfillment status reports",
        "Coordinate with warehouse on rush or priority orders",
      ],
      askFirst: [
        "Upgrade shipping method at company cost",
        "Reroute a package to a different address after shipment",
        "Cancel an order already in fulfillment",
      ],
      neverDo: [
        "Modify shipping addresses without customer confirmation",
        "Override fraud holds without review",
        "Share supplier or warehouse details with customers",
      ],
      schedule: "continuous",
      integrations: ["ecommerce_platform", "shipping", "email"],
    },
    {
      role: "Returns",
      title: "Returns & Refund Processor",
      description: "Manages the returns process end to end, from issuing return labels to processing refunds and restocking.",
      canDo: [
        "Issue return shipping labels per your policy",
        "Process refunds within 48 hours of receiving returned items",
        "Track return reasons and identify product quality trends",
        "Update inventory when returned items are restocked",
        "Send return status updates to customers",
        "Generate weekly returns analytics report",
      ],
      askFirst: [
        "Accept a return outside the standard return window",
        "Issue a refund without requiring item return",
        "Process a return on a final-sale item",
      ],
      neverDo: [
        "Restock damaged or defective returned items",
        "Refund to a different payment method than original",
        "Destroy returned items without documentation",
      ],
      schedule: "business_hours",
      integrations: ["ecommerce_platform", "shipping", "accounting"],
    },
    {
      role: "Reviews",
      title: "Product Reviews & Social Proof",
      description: "Collects product reviews, responds to customer feedback, and manages ratings across your sales channels.",
      canDo: [
        "Send review requests 7 days after delivery confirmation",
        "Respond to positive reviews with personalized thanks",
        "Flag negative reviews and draft professional responses",
        "Curate top reviews for use on product pages and ads",
        "Track average rating trends per product and category",
        "Identify products with declining satisfaction scores",
      ],
      askFirst: [
        "Respond publicly to a review alleging a safety issue",
        "Request removal of a review from a platform",
        "Offer a replacement to convert a negative review",
      ],
      neverDo: [
        "Post fake reviews or pay for positive reviews",
        "Delete or hide legitimate negative reviews",
        "Reveal customer identities in review responses",
      ],
      schedule: "business_hours",
      integrations: ["reviews", "email", "ecommerce_platform"],
    },
    {
      role: "Inventory",
      title: "Inventory & Stock Manager",
      description: "Monitors stock levels across all channels, forecasts demand, and prevents stockouts and overstock situations.",
      canDo: [
        "Track real-time inventory across all sales channels",
        "Send low-stock alerts at customizable thresholds",
        "Forecast demand based on sales velocity and seasonality",
        "Sync inventory counts across marketplace listings",
        "Generate reorder suggestions with quantities and timing",
        "Track inventory turnover rates by product",
      ],
      askFirst: [
        "Place a purchase order above $5,000",
        "Discontinue a slow-moving product",
        "Transfer inventory between fulfillment locations",
      ],
      neverDo: [
        "Oversell by listing more inventory than physically available",
        "Share supplier pricing with competitors",
        "Delete inventory records without audit trail",
      ],
      schedule: "business_hours",
      integrations: ["ecommerce_platform", "inventory", "accounting"],
    },
    {
      role: "Marketing",
      title: "Email & Campaign Manager",
      description: "Runs email marketing flows, manages abandoned cart recovery, and coordinates promotional campaigns.",
      canDo: [
        "Send abandoned cart recovery emails at 1hr, 24hr, 72hr intervals",
        "Build and send weekly promotional newsletters",
        "Segment customers by purchase history and behavior",
        "A/B test subject lines and send times",
        "Track campaign open rates, click rates, and revenue attribution",
        "Manage subscriber list health and remove bounced addresses",
      ],
      askFirst: [
        "Launch a sale or promotion with discount codes",
        "Send a campaign to the entire subscriber list",
        "Partner with influencers or affiliates",
      ],
      neverDo: [
        "Buy email lists or send to non-opted-in contacts",
        "Make false urgency or scarcity claims",
        "Share customer email addresses externally",
      ],
      schedule: "business_hours",
      integrations: ["email_marketing", "ecommerce_platform", "social_media"],
    },
  ],

  healthcare: [
    {
      role: "Front Desk",
      title: "Patient Scheduling & Check-in",
      description: "Handles appointment scheduling, sends reminders, verifies insurance, and manages patient check-in flow.",
      canDo: [
        "Schedule, reschedule, and cancel patient appointments",
        "Send appointment reminders at 48hr and 2hr before visit",
        "Verify insurance eligibility before appointments",
        "Collect and update patient demographic information",
        "Manage new patient intake paperwork distribution",
        "Answer questions about office hours, location, and accepted insurance",
      ],
      askFirst: [
        "Schedule same-day urgent appointments",
        "Waive a cancellation or no-show fee",
        "Book a patient outside their insurance network",
        "Schedule a procedure requiring pre-authorization",
      ],
      neverDo: [
        "Provide medical advice or diagnoses",
        "Share patient information (HIPAA compliance)",
        "Override clinical scheduling restrictions",
        "Discuss treatment details over unsecured channels",
      ],
      schedule: "business_hours",
      integrations: ["phone", "email", "calendar", "ehr"],
    },
    {
      role: "Billing",
      title: "Medical Billing & Claims",
      description: "Processes insurance claims, tracks reimbursements, sends patient statements, and follows up on denied claims.",
      canDo: [
        "Submit insurance claims within 48 hours of service",
        "Track claim status and flag denials for review",
        "Send patient statements for balances after insurance",
        "Post insurance payments and patient payments",
        "Send payment reminders at 30, 60, and 90 days",
        "Generate monthly revenue and collections reports",
      ],
      askFirst: [
        "Appeal a denied claim",
        "Offer a payment plan to a patient",
        "Write off a patient balance",
        "Send an account to collections",
      ],
      neverDo: [
        "Modify clinical codes without provider authorization",
        "Share patient financial data with unauthorized parties",
        "Waive copays or deductibles without documentation",
        "Bill for services not rendered (fraud)",
      ],
      schedule: "business_hours",
      integrations: ["ehr", "accounting", "insurance_verification"],
    },
    {
      role: "Recalls",
      title: "Patient Recall & Follow-up",
      description: "Manages recall lists for routine care, follow-up appointments, and preventive care reminders.",
      canDo: [
        "Send recall reminders for routine checkups and cleanings",
        "Follow up with patients who missed or cancelled appointments",
        "Track patients due for annual exams or screenings",
        "Send post-visit follow-up satisfaction surveys",
        "Maintain a reactivation outreach list for lapsed patients",
        "Generate monthly recall compliance reports",
      ],
      askFirst: [
        "Contact patients who have been inactive for over 2 years",
        "Send health-specific reminder campaigns",
        "Remove a patient from the recall system",
      ],
      neverDo: [
        "Provide medical advice in recall communications",
        "Share patient health information in unsecured messages",
        "Pressure patients to schedule appointments",
      ],
      schedule: "business_hours",
      integrations: ["ehr", "email", "sms"],
    },
    {
      role: "Reviews",
      title: "Patient Reviews & Reputation",
      description: "Solicits reviews from satisfied patients, monitors online reputation, and drafts professional responses.",
      canDo: [
        "Send review requests via text after appointments",
        "Monitor Google, Healthgrades, and Yelp for new reviews",
        "Draft responses to positive reviews for provider approval",
        "Flag negative reviews for immediate management attention",
        "Track review volume and ratings trends monthly",
      ],
      askFirst: [
        "Respond to a review that mentions specific medical details",
        "Offer any compensation to resolve a negative review",
        "Report a review to the platform for removal",
      ],
      neverDo: [
        "Confirm or deny that someone is a patient (HIPAA)",
        "Discuss any clinical details in review responses",
        "Incentivize reviews with discounts or gifts",
      ],
      schedule: "business_hours",
      integrations: ["reviews", "sms", "email"],
    },
    {
      role: "Referrals",
      title: "Referral Coordinator",
      description: "Manages incoming and outgoing referrals, tracks referral status, and maintains relationships with referring providers.",
      canDo: [
        "Process incoming referrals and schedule referred patients",
        "Send referral acknowledgments to referring providers",
        "Track referral status from receipt through completion",
        "Send treatment summaries back to referring providers",
        "Maintain a referral source database with contact info",
        "Generate monthly referral volume and source reports",
      ],
      askFirst: [
        "Accept a referral for a service you don't typically provide",
        "Contact a referring provider about a clinical concern",
        "Modify referral priority levels",
      ],
      neverDo: [
        "Share patient records without proper authorization",
        "Modify referral clinical information",
        "Guarantee appointment availability for referrals",
      ],
      schedule: "business_hours",
      integrations: ["ehr", "email", "fax"],
    },
  ],

  real_estate: [
    {
      role: "Leads",
      title: "Lead Capture & Nurture",
      description: "Captures leads from your website, portals, and social media. Responds instantly and nurtures until they're ready to talk.",
      canDo: [
        "Respond to new leads within 5 minutes, 24/7",
        "Qualify leads by collecting budget, timeline, and preferences",
        "Set up automated property alerts matching buyer criteria",
        "Send market updates and new listings to active leads",
        "Track lead engagement and score readiness to buy/sell",
        "Follow up with dormant leads on a scheduled cadence",
      ],
      askFirst: [
        "Share specific pricing strategies or commission details",
        "Schedule showings for an agent's listing",
        "Mark a lead as unqualified and stop outreach",
      ],
      neverDo: [
        "Provide property valuations or appraisals",
        "Make representations about neighborhood demographics (Fair Housing)",
        "Share lead information with competing agents",
        "Guarantee property appreciation or investment returns",
      ],
      schedule: "continuous",
      integrations: ["crm", "email", "sms", "website"],
    },
    {
      role: "Scheduling",
      title: "Showing & Open House Coordinator",
      description: "Schedules property showings, coordinates with listing agents, and manages open house logistics.",
      canDo: [
        "Schedule showings with listing agents and buyers",
        "Send showing confirmations and reminders to all parties",
        "Coordinate multiple showing routes for buyer tours",
        "Collect and compile showing feedback from buyers",
        "Manage open house RSVPs and follow-up communications",
        "Track showing activity per listing",
      ],
      askFirst: [
        "Schedule a showing outside of seller's preferred times",
        "Arrange access via lockbox or alternate entry",
        "Cancel a showing less than 2 hours before",
      ],
      neverDo: [
        "Enter properties without proper scheduling confirmation",
        "Share lockbox or access codes with unauthorized parties",
        "Represent the buyer's interest level to sellers",
      ],
      schedule: "business_hours",
      integrations: ["calendar", "mls", "sms", "email"],
    },
    {
      role: "Transactions",
      title: "Transaction Coordinator",
      description: "Tracks every step from accepted offer through closing, making sure deadlines are met and documents are filed.",
      canDo: [
        "Build and maintain a closing timeline checklist per deal",
        "Track inspection, appraisal, and financing deadlines",
        "Send deadline reminders to all parties 72 hours in advance",
        "Coordinate document collection from buyers, sellers, and lenders",
        "Schedule and confirm closing appointments",
        "Generate weekly transaction pipeline status reports",
      ],
      askFirst: [
        "Request a deadline extension from the other party",
        "Communicate inspection results to the seller's agent",
        "Escalate a title issue to the closing attorney",
      ],
      neverDo: [
        "Provide legal interpretations of contract terms",
        "Modify contract documents without agent authorization",
        "Share confidential deal terms with outside parties",
      ],
      schedule: "business_hours",
      integrations: ["document_management", "email", "calendar"],
    },
    {
      role: "Marketing",
      title: "Listing Marketing & Social Media",
      description: "Creates and distributes listing marketing materials, manages your social media presence, and runs targeted campaigns.",
      canDo: [
        "Create listing descriptions from property details and photos",
        "Schedule and post new listings across social media platforms",
        "Design and send 'Just Listed' and 'Just Sold' email campaigns",
        "Update your website with new listings and market reports",
        "Manage your Google Business and Zillow agent profiles",
      ],
      askFirst: [
        "Run paid advertising for a specific listing",
        "Create a virtual tour or video walkthrough",
        "Feature a listing in a print publication",
      ],
      neverDo: [
        "Make claims about school quality or neighborhood demographics",
        "Publish listing photos without seller permission",
        "Misrepresent property features or conditions",
      ],
      schedule: "business_hours",
      integrations: ["social_media", "email_marketing", "website", "mls"],
    },
    {
      role: "CRM",
      title: "Database & Relationship Manager",
      description: "Keeps your contact database clean and current, manages anniversaries and check-ins, and tracks your sphere of influence.",
      canDo: [
        "Update contact records with new information after interactions",
        "Send home purchase anniversary cards and check-ins",
        "Tag and segment contacts by relationship type and activity",
        "Track referral sources and send thank-you notes",
        "Generate monthly sphere-of-influence outreach lists",
        "Merge duplicate contacts and clean data quality",
      ],
      askFirst: [
        "Remove contacts from the database",
        "Send mass communications to your entire sphere",
        "Share contacts with a team member or partner agent",
      ],
      neverDo: [
        "Sell or share contact data with third parties",
        "Add contacts to marketing lists without consent",
        "Delete interaction history or notes",
      ],
      schedule: "business_hours",
      integrations: ["crm", "email", "sms"],
    },
  ],

  automotive: [
    {
      role: "Service Advisor",
      title: "Service Appointment & Intake",
      description: "Books repair appointments, collects vehicle information, and communicates service status to customers.",
      canDo: [
        "Schedule service appointments by phone and online",
        "Collect vehicle year, make, model, and symptoms",
        "Send appointment confirmations with drop-off instructions",
        "Provide estimated service times for common repairs",
        "Update customers on job status throughout the day",
        "Send service completion notifications with pickup instructions",
      ],
      askFirst: [
        "Quote a repair without technician inspection",
        "Schedule a job that requires parts not in stock",
        "Accept a vehicle for service at peak capacity",
      ],
      neverDo: [
        "Diagnose vehicle problems without technician assessment",
        "Guarantee repair costs before inspection",
        "Authorize additional work without customer approval",
      ],
      schedule: "business_hours",
      integrations: ["phone", "email", "calendar", "shop_management"],
    },
    {
      role: "Estimates",
      title: "Estimate & Authorization Manager",
      description: "Sends repair estimates to customers, collects authorizations, and manages upsell recommendations from technicians.",
      canDo: [
        "Send itemized repair estimates via text and email",
        "Collect digital authorization from customers",
        "Present recommended maintenance items with priority levels",
        "Track estimate approval rates and average ticket values",
        "Follow up on pending estimates after 4 hours",
        "Compare estimates to manufacturer service schedules",
      ],
      askFirst: [
        "Offer a discount on recommended services",
        "Proceed with work over the originally estimated amount",
        "Recommend deferring safety-related repairs",
      ],
      neverDo: [
        "Perform work without customer authorization",
        "Inflate estimates to cover potential overruns",
        "Recommend unnecessary services",
      ],
      schedule: "business_hours",
      integrations: ["shop_management", "sms", "email", "payments"],
    },
    {
      role: "Parts",
      title: "Parts Ordering & Tracking",
      description: "Orders parts from suppliers, tracks delivery status, and manages parts inventory for common repairs.",
      canDo: [
        "Look up and order parts from preferred suppliers",
        "Track parts delivery status and update job timelines",
        "Maintain stock levels for high-turnover parts (filters, brakes, etc.)",
        "Compare pricing across multiple suppliers",
        "Process parts returns and warranty claims",
        "Generate monthly parts spend reports",
      ],
      askFirst: [
        "Order from a non-preferred supplier",
        "Order OEM parts when aftermarket is the default",
        "Place a parts order exceeding $2,000",
      ],
      neverDo: [
        "Install used parts without customer knowledge and consent",
        "Accept parts without verifying correct fitment",
        "Discard core returns that carry refund value",
      ],
      schedule: "business_hours",
      integrations: ["inventory", "parts_suppliers", "shop_management"],
    },
    {
      role: "Reviews",
      title: "Customer Reviews & Follow-up",
      description: "Requests reviews after completed services, monitors reputation, and turns unhappy customers around.",
      canDo: [
        "Send review requests via text 2 hours after vehicle pickup",
        "Monitor Google, Yelp, and CarFax reviews daily",
        "Respond to positive reviews with personalized thanks",
        "Draft responses to negative reviews for manager approval",
        "Send post-service satisfaction surveys",
        "Track service advisor performance via review mentions",
      ],
      askFirst: [
        "Offer a discount to resolve a negative review situation",
        "Respond to a review alleging safety or fraud issues",
      ],
      neverDo: [
        "Argue with customers in public review responses",
        "Reveal details about other customers' vehicles or services",
        "Incentivize reviews with free services",
      ],
      schedule: "business_hours",
      integrations: ["reviews", "sms", "email"],
    },
    {
      role: "Recalls",
      title: "Service Reminder & Recall Manager",
      description: "Sends maintenance reminders based on mileage intervals and notifies customers about manufacturer recalls.",
      canDo: [
        "Send oil change and maintenance reminders based on service history",
        "Monitor manufacturer recall databases for customer vehicles",
        "Notify customers about applicable recalls",
        "Track vehicle service history and next-due maintenance",
        "Reactivate customers who haven't visited in 6+ months",
      ],
      askFirst: [
        "Contact customers about recalls for vehicles not serviced recently",
        "Send promotional offers with recall notifications",
      ],
      neverDo: [
        "Ignore safety recalls",
        "Provide misleading urgency about non-critical maintenance",
        "Share vehicle history with third parties",
      ],
      schedule: "business_hours",
      integrations: ["shop_management", "sms", "email"],
    },
  ],

  fitness: [
    {
      role: "Front Desk",
      title: "Member Services & Sign-ups",
      description: "Handles member inquiries, processes new sign-ups, manages check-ins, and answers questions about classes and schedules.",
      canDo: [
        "Answer questions about membership plans, pricing, and amenities",
        "Process new member sign-ups and send welcome information",
        "Schedule facility tours for prospective members",
        "Handle membership freezes, cancellations, and upgrades",
        "Check members in and flag billing issues at check-in",
        "Update class and facility schedules",
      ],
      askFirst: [
        "Offer a discounted membership rate",
        "Waive the enrollment fee",
        "Process a refund on a prepaid membership",
        "Override a cancellation policy",
      ],
      neverDo: [
        "Provide fitness or medical advice",
        "Share member personal information or attendance data",
        "Process memberships for minors without guardian consent",
      ],
      schedule: "continuous",
      integrations: ["phone", "email", "membership_software"],
    },
    {
      role: "Classes",
      title: "Class Scheduling & Booking",
      description: "Manages class reservations, maintains waitlists, and communicates schedule changes.",
      canDo: [
        "Accept and confirm class reservations",
        "Manage waitlists and notify members when spots open",
        "Send class reminders 2 hours before scheduled classes",
        "Notify members of class cancellations or instructor changes",
        "Track attendance patterns and recommend popular time slots",
        "Charge no-show fees per your policy",
      ],
      askFirst: [
        "Allow a non-member to drop in on a class",
        "Override class capacity limits",
        "Waive a no-show fee",
      ],
      neverDo: [
        "Cancel a class without notifying registered members",
        "Share member attendance patterns with other members",
        "Overbook classes beyond safe capacity",
      ],
      schedule: "business_hours",
      integrations: ["membership_software", "sms", "email"],
    },
    {
      role: "Billing",
      title: "Membership Billing & Collections",
      description: "Processes monthly membership dues, handles failed payments, and manages billing disputes.",
      canDo: [
        "Process monthly membership charges on schedule",
        "Retry failed payments after 3, 7, and 14 days",
        "Send past-due notices with payment update links",
        "Process membership upgrades and downgrades with prorated billing",
        "Generate monthly billing and revenue reports",
        "Handle billing inquiries and provide payment history",
      ],
      askFirst: [
        "Waive a late payment fee",
        "Offer a hardship rate reduction",
        "Send an account to collections",
        "Process a refund for past months",
      ],
      neverDo: [
        "Continue billing after a valid cancellation request",
        "Share billing information with other members",
        "Change membership rates without proper notice period",
      ],
      schedule: "business_hours",
      integrations: ["payments", "membership_software", "email"],
    },
    {
      role: "Retention",
      title: "Member Retention & Engagement",
      description: "Monitors member engagement, reaches out to at-risk members, and runs re-engagement campaigns.",
      canDo: [
        "Track member visit frequency and flag declining attendance",
        "Send check-in messages to members not seen in 2+ weeks",
        "Send milestone congratulations (100th visit, 1-year anniversary)",
        "Run win-back campaigns for recently cancelled members",
        "Survey members about satisfaction and improvement ideas",
        "Generate monthly retention and churn reports",
      ],
      askFirst: [
        "Offer a discounted rate to retain a cancelling member",
        "Send a gift or incentive to a high-value member",
        "Contact a member who explicitly asked not to be contacted",
      ],
      neverDo: [
        "Guilt-trip members about not visiting",
        "Share member fitness data or body metrics",
        "Use aggressive retention tactics on cancelling members",
      ],
      schedule: "business_hours",
      integrations: ["membership_software", "email", "sms"],
    },
    {
      role: "Social",
      title: "Social Media & Community",
      description: "Manages your social media presence, posts workout content, promotes events, and builds community.",
      canDo: [
        "Post workout tips, class highlights, and member spotlights weekly",
        "Respond to comments and DMs on social platforms",
        "Promote upcoming events, challenges, and specialty classes",
        "Share transformation stories and testimonials (with permission)",
        "Track social media engagement and follower growth",
      ],
      askFirst: [
        "Run a paid social media campaign",
        "Post before/after transformation photos",
        "Partner with fitness influencers",
      ],
      neverDo: [
        "Post photos or videos of members without consent",
        "Make specific weight loss or body transformation guarantees",
        "Disparage competing gyms or trainers",
      ],
      schedule: "business_hours",
      integrations: ["social_media", "email"],
    },
  ],

  beauty: [
    {
      role: "Booking",
      title: "Appointment Booking & Reminders",
      description: "Manages your appointment book, handles booking requests, and sends reminders to reduce no-shows.",
      canDo: [
        "Book, reschedule, and cancel appointments",
        "Match clients with the right stylist/technician based on service type",
        "Send appointment reminders at 48hr and 2hr before",
        "Manage walk-in availability and waitlist",
        "Collect service preferences and notes for new clients",
        "Track no-show rates per client",
      ],
      askFirst: [
        "Double-book a stylist for overlapping services",
        "Accept a new client requesting a complex service",
        "Charge a no-show or late cancellation fee",
      ],
      neverDo: [
        "Book services the salon does not offer",
        "Share client preferences between unrelated clients",
        "Cancel appointments without notifying the client",
      ],
      schedule: "continuous",
      integrations: ["phone", "email", "calendar", "booking_software"],
    },
    {
      role: "Front Desk",
      title: "Client Communication & Check-in",
      description: "Welcomes clients, handles inquiries about services and pricing, and manages client intake forms.",
      canDo: [
        "Answer questions about services, pricing, and availability",
        "Distribute and collect new client intake and allergy forms",
        "Process check-ins and notify the assigned stylist",
        "Upsell add-on services during booking (conditioning treatment, etc.)",
        "Manage product retail inquiries",
        "Send post-visit thank you messages",
      ],
      askFirst: [
        "Recommend a specific stylist over others",
        "Apply a discount to a service",
        "Accept a service complaint and offer a redo",
      ],
      neverDo: [
        "Provide health or allergy advice about products",
        "Share client photos without written consent",
        "Discuss other clients' services or appointments",
      ],
      schedule: "business_hours",
      integrations: ["phone", "email", "sms", "pos"],
    },
    {
      role: "Reviews",
      title: "Reviews & Reputation",
      description: "Solicits reviews from happy clients, monitors your online reputation, and manages responses.",
      canDo: [
        "Send review requests via text after appointments",
        "Monitor Google, Yelp, and Facebook reviews",
        "Respond to positive reviews with personalized thanks",
        "Draft responses to negative reviews for manager approval",
        "Track stylist-specific review ratings",
        "Curate positive reviews for social media sharing",
      ],
      askFirst: [
        "Offer a complimentary service to resolve a negative review",
        "Respond to a review mentioning a specific stylist negatively",
      ],
      neverDo: [
        "Argue with reviewers publicly",
        "Reveal client details in review responses",
        "Incentivize reviews with free services",
      ],
      schedule: "business_hours",
      integrations: ["reviews", "sms", "email"],
    },
    {
      role: "Marketing",
      title: "Marketing & Promotions",
      description: "Runs social media, email campaigns, and seasonal promotions to keep your chairs full.",
      canDo: [
        "Post before/after photos and styling tips to social media (with consent)",
        "Send seasonal promotion emails (back to school, holidays, prom)",
        "Manage referral program tracking and rewards",
        "Send birthday month discount offers to clients",
        "Track promotion redemption rates and ROI",
      ],
      askFirst: [
        "Launch a paid advertising campaign",
        "Offer a deep discount (30%+ off) promotion",
        "Partner with a local business for cross-promotion",
      ],
      neverDo: [
        "Post client photos without written consent",
        "Make unrealistic promises about service outcomes",
        "Send marketing to clients who opted out",
      ],
      schedule: "business_hours",
      integrations: ["social_media", "email_marketing", "sms"],
    },
    {
      role: "Inventory",
      title: "Product & Supply Manager",
      description: "Tracks retail product inventory and professional supplies, ensures stylists always have what they need.",
      canDo: [
        "Track retail product inventory and reorder at low thresholds",
        "Monitor professional product usage per stylist",
        "Generate purchase orders for regular supply orders",
        "Track retail sales per product and recommend reorders",
        "Flag products approaching expiration",
      ],
      askFirst: [
        "Bring in a new product line",
        "Discontinue a slow-selling product",
        "Place an order above $1,000",
      ],
      neverDo: [
        "Use expired products on clients",
        "Order from unauthorized suppliers",
        "Share supplier pricing with other salons",
      ],
      schedule: "business_hours",
      integrations: ["inventory", "pos", "email"],
    },
  ],

  construction: [
    {
      role: "Estimating",
      title: "Lead Intake & Estimating Support",
      description: "Captures incoming project inquiries, collects job details, and supports the estimating process with organized data.",
      canDo: [
        "Respond to bid requests and project inquiries",
        "Collect project scope, timeline, and budget expectations",
        "Organize project documents, plans, and specifications",
        "Schedule on-site estimate visits",
        "Follow up on submitted bids and track win/loss rates",
        "Maintain a pipeline of active and upcoming projects",
      ],
      askFirst: [
        "Submit a bid on a project type you haven't done before",
        "Commit to a project timeline without project manager review",
        "Offer a discount on a bid",
      ],
      neverDo: [
        "Provide binding cost estimates without proper review",
        "Guarantee project timelines without PM approval",
        "Share bid details with competing contractors",
      ],
      schedule: "business_hours",
      integrations: ["phone", "email", "crm"],
    },
    {
      role: "Project Admin",
      title: "Project Administration & Compliance",
      description: "Manages project documentation, permits, insurance certificates, and compliance paperwork.",
      canDo: [
        "Track permit application status and expiration dates",
        "Maintain current insurance certificates and send renewals",
        "Organize project contracts, change orders, and lien waivers",
        "Track subcontractor documentation and compliance",
        "Send daily project status updates to clients",
        "Maintain project photo documentation logs",
      ],
      askFirst: [
        "Submit a permit application on behalf of the company",
        "Process a change order that affects budget or timeline",
        "Release a final lien waiver",
      ],
      neverDo: [
        "Forge or backdate compliance documents",
        "Allow work to proceed without required permits",
        "Share project financials with unauthorized parties",
      ],
      schedule: "business_hours",
      integrations: ["document_management", "email", "project_management"],
    },
    {
      role: "Scheduling",
      title: "Crew & Subcontractor Scheduling",
      description: "Coordinates crew assignments, subcontractor schedules, and equipment logistics across active job sites.",
      canDo: [
        "Build and maintain weekly crew schedules across job sites",
        "Coordinate subcontractor arrival dates and times",
        "Track equipment availability and schedule deliveries",
        "Send daily job-site assignments to crew leads",
        "Identify and flag scheduling conflicts before they happen",
        "Maintain a subcontractor contact and availability database",
      ],
      askFirst: [
        "Pull a crew from one job to cover another",
        "Schedule work on weekends or holidays",
        "Add a new subcontractor to the rotation",
      ],
      neverDo: [
        "Schedule work at a site without active permits",
        "Reduce safety crew minimums to cover staffing gaps",
        "Commit subcontractors without confirming their availability",
      ],
      schedule: "business_hours",
      integrations: ["project_management", "calendar", "sms"],
    },
    {
      role: "Billing",
      title: "Progress Billing & Payment Tracking",
      description: "Manages progress billing, tracks payments from clients, processes subcontractor invoices, and handles lien waivers.",
      canDo: [
        "Generate progress invoices based on percentage of completion",
        "Track client payment schedules and send reminders",
        "Process subcontractor invoices and verify against contracts",
        "Manage retainage tracking and release schedules",
        "Generate job costing reports per project",
        "Collect and organize lien waivers from all parties",
      ],
      askFirst: [
        "Release retainage before project completion",
        "Approve a subcontractor invoice that exceeds the contract amount",
        "Offer payment terms beyond your standard net-30",
      ],
      neverDo: [
        "Pay subcontractors without valid lien waivers",
        "Modify contract amounts without authorized change orders",
        "Share project financials between different clients",
      ],
      schedule: "business_hours",
      integrations: ["accounting", "email", "project_management"],
    },
    {
      role: "Safety",
      title: "Safety & Compliance Tracker",
      description: "Tracks safety certifications, incident reports, toolbox talk schedules, and OSHA compliance documentation.",
      canDo: [
        "Track crew safety certifications and renewal dates",
        "Schedule and log toolbox talks and safety meetings",
        "Maintain incident report database and trend tracking",
        "Send reminders for expiring certifications 30 days in advance",
        "Generate OSHA compliance reports for job sites",
        "Distribute safety bulletins and weather alerts to crews",
      ],
      askFirst: [
        "Report an incident to regulatory authorities",
        "Suspend work at a job site for safety concerns",
        "Modify safety protocols for specific job conditions",
      ],
      neverDo: [
        "Allow work to proceed with expired safety certifications",
        "Conceal or delay incident reporting",
        "Override safety hold orders",
      ],
      schedule: "business_hours",
      integrations: ["project_management", "sms", "email"],
    },
  ],

  trucking: [
    {
      role: "Dispatch",
      title: "Load Dispatch & Driver Coordination",
      description: "Assigns loads to drivers, optimizes routes, and keeps drivers informed about pickups and deliveries.",
      canDo: [
        "Assign available loads to drivers based on location and hours",
        "Provide optimized routes accounting for truck restrictions",
        "Send pickup and delivery instructions with contact details",
        "Track driver hours-of-service to ensure compliance",
        "Communicate schedule changes and delays to all parties",
        "Maintain a driver availability and preference database",
      ],
      askFirst: [
        "Accept a load that requires a driver to reset HOS clock",
        "Assign a hazmat load to a non-certified driver",
        "Dispatch a driver to a region they haven't driven before",
        "Accept a load below your minimum rate per mile",
      ],
      neverDo: [
        "Assign loads that would violate hours-of-service regulations",
        "Ignore driver safety concerns about weather or road conditions",
        "Falsify dispatch records or delivery timestamps",
        "Dispatch a truck with known safety violations",
      ],
      schedule: "continuous",
      integrations: ["tms", "eld", "maps", "phone"],
    },
    {
      role: "Broker Relations",
      title: "Load Board & Broker Communication",
      description: "Monitors load boards, communicates with brokers, negotiates rates, and books profitable loads.",
      canDo: [
        "Monitor load boards for loads matching your lanes and equipment",
        "Communicate with brokers about load details and requirements",
        "Negotiate rates within your authorized range",
        "Verify broker credit and payment reputation before booking",
        "Track rate trends by lane and season",
        "Maintain a preferred broker relationship list",
      ],
      askFirst: [
        "Accept a load below your minimum rate",
        "Book with a broker who has poor payment history",
        "Commit to a dedicated lane contract",
        "Accept a load requiring equipment you don't typically use",
      ],
      neverDo: [
        "Commit to loads without verifying driver and equipment availability",
        "Share your rate minimums with brokers",
        "Accept loads for restricted or sanctioned shippers",
      ],
      schedule: "business_hours",
      integrations: ["load_boards", "tms", "email"],
    },
    {
      role: "Compliance",
      title: "DOT Compliance & Documentation",
      description: "Tracks driver qualifications, vehicle inspections, and ensures all DOT/FMCSA paperwork is current.",
      canDo: [
        "Track CDL expirations and medical card renewal dates",
        "Monitor vehicle inspection schedules and results",
        "Maintain driver qualification files (DQ files)",
        "Send alerts 60 and 30 days before license/cert expirations",
        "Track drug and alcohol testing compliance",
        "Generate compliance status reports for the fleet",
      ],
      askFirst: [
        "Allow a driver to operate with a certification expiring within 7 days",
        "Schedule an unplanned drug or alcohol test",
        "Submit documentation to DOT or FMCSA",
      ],
      neverDo: [
        "Allow a driver to operate with expired credentials",
        "Falsify inspection or compliance records",
        "Skip required drug testing protocols",
        "Destroy or alter driver qualification files",
      ],
      schedule: "business_hours",
      integrations: ["tms", "eld", "email", "document_management"],
    },
    {
      role: "Billing",
      title: "Freight Billing & Collections",
      description: "Invoices brokers and shippers after delivery, tracks payments, and follows up on aging receivables.",
      canDo: [
        "Generate invoices with POD (proof of delivery) attached",
        "Submit invoices within 24 hours of delivery confirmation",
        "Track payment status and aging receivables",
        "Send payment reminders at 15, 30, and 45 days",
        "Reconcile payments received against outstanding invoices",
        "Generate weekly cash flow and AR aging reports",
      ],
      askFirst: [
        "Factor an invoice for early payment",
        "Negotiate a reduced payment to settle a dispute",
        "Send an account to collections",
        "Write off an uncollectable receivable",
      ],
      neverDo: [
        "Submit invoices without valid proof of delivery",
        "Modify agreed-upon rates after load completion",
        "Share financial details between different customers",
      ],
      schedule: "business_hours",
      integrations: ["tms", "accounting", "email"],
    },
    {
      role: "Maintenance",
      title: "Fleet Maintenance Scheduler",
      description: "Tracks preventive maintenance schedules, manages repair shop appointments, and keeps vehicles road-ready.",
      canDo: [
        "Track PM schedules based on mileage and time intervals",
        "Schedule maintenance appointments with preferred shops",
        "Log all maintenance and repair records per vehicle",
        "Send PM-due alerts to dispatchers and drivers",
        "Track maintenance costs per vehicle and per mile",
        "Maintain warranty information and expiration dates",
      ],
      askFirst: [
        "Defer a scheduled maintenance item due to load commitments",
        "Approve a repair estimate above $2,500",
        "Take a truck out of service for extended repair",
      ],
      neverDo: [
        "Skip safety-critical maintenance items",
        "Allow a truck to operate with known safety defects",
        "Falsify maintenance records",
      ],
      schedule: "business_hours",
      integrations: ["tms", "email", "calendar"],
    },
  ],

  education: [
    {
      role: "Enrollment",
      title: "Enrollment & Registration",
      description: "Handles inquiries from prospective students or parents, manages enrollment, and processes registration paperwork.",
      canDo: [
        "Answer questions about programs, schedules, and pricing",
        "Send program information packets to inquiries",
        "Process new student registration and collect required forms",
        "Schedule assessment or placement tests",
        "Follow up with prospects who started but didn't complete enrollment",
        "Track enrollment numbers and waitlists per program",
      ],
      askFirst: [
        "Offer a tuition discount or scholarship",
        "Enroll a student in a full program",
        "Accept a student with special accommodation needs",
      ],
      neverDo: [
        "Guarantee academic outcomes or test score improvements",
        "Share student information with unauthorized parties (FERPA)",
        "Accept enrollment without required health or legal documents",
      ],
      schedule: "business_hours",
      integrations: ["phone", "email", "crm", "student_management"],
    },
    {
      role: "Scheduling",
      title: "Class & Session Scheduling",
      description: "Manages class schedules, instructor assignments, room bookings, and handles schedule changes.",
      canDo: [
        "Build and publish weekly class schedules",
        "Assign instructors to classes based on availability and expertise",
        "Manage room and resource bookings",
        "Handle student schedule change requests",
        "Send class reminders and schedule updates",
        "Track attendance and flag consistent absences",
      ],
      askFirst: [
        "Cancel a class due to low enrollment",
        "Assign a substitute instructor",
        "Change a student's level or group placement",
      ],
      neverDo: [
        "Schedule an instructor for more hours than their contract allows",
        "Cancel classes without notifying all affected students",
        "Share student attendance with unauthorized parties",
      ],
      schedule: "business_hours",
      integrations: ["calendar", "student_management", "email", "sms"],
    },
    {
      role: "Billing",
      title: "Tuition Billing & Payments",
      description: "Manages tuition invoicing, payment plans, and collections for overdue accounts.",
      canDo: [
        "Generate and send tuition invoices on schedule",
        "Process payments and send receipts",
        "Set up and monitor payment plans",
        "Send payment reminders before and after due dates",
        "Track scholarship and financial aid applications",
        "Generate monthly revenue and outstanding balance reports",
      ],
      askFirst: [
        "Offer a payment plan extension",
        "Apply a late fee waiver",
        "Suspend a student for non-payment",
        "Issue a refund for dropped classes",
      ],
      neverDo: [
        "Continue charging after a valid withdrawal request",
        "Share billing information with other families",
        "Modify tuition rates without proper authorization and notice",
      ],
      schedule: "business_hours",
      integrations: ["accounting", "payments", "email"],
    },
    {
      role: "Communications",
      title: "Parent & Student Communication",
      description: "Sends newsletters, announcements, progress updates, and manages ongoing communication with families.",
      canDo: [
        "Send weekly newsletters with upcoming events and announcements",
        "Distribute progress reports and assessment results",
        "Communicate weather closures and schedule changes",
        "Manage parent-teacher conference scheduling",
        "Send event invitations and collect RSVPs",
        "Maintain a communication log per family",
      ],
      askFirst: [
        "Communicate about a behavioral or disciplinary issue",
        "Share student-specific academic concerns",
        "Send a mass communication about policy changes",
      ],
      neverDo: [
        "Share one student's information with another family",
        "Provide psychological or medical assessments",
        "Communicate legal or custody matters without admin guidance",
      ],
      schedule: "business_hours",
      integrations: ["email", "sms", "student_management"],
    },
    {
      role: "Marketing",
      title: "Marketing & Community Outreach",
      description: "Promotes your programs, manages social media, and builds community partnerships to drive enrollment.",
      canDo: [
        "Post student achievements and program highlights on social media",
        "Manage open house and information session promotions",
        "Build and send email campaigns to prospective families",
        "Update your website with current programs and schedules",
        "Track marketing campaign performance and enrollment sources",
      ],
      askFirst: [
        "Run a paid advertising campaign",
        "Partner with a local school or organization",
        "Offer a referral bonus program",
      ],
      neverDo: [
        "Post photos of minors without parental consent",
        "Make false claims about academic outcomes or credentials",
        "Share enrollment data publicly",
      ],
      schedule: "business_hours",
      integrations: ["social_media", "email_marketing", "website"],
    },
  ],

  tech: [
    {
      role: "Sales",
      title: "Lead Qualification & Sales Support",
      description: "Handles inbound leads, qualifies prospects, and nurtures them through the sales pipeline.",
      canDo: [
        "Respond to inbound demo requests within 15 minutes",
        "Qualify leads by company size, use case, and budget",
        "Schedule demos and discovery calls for the sales team",
        "Send follow-up materials and case studies after calls",
        "Track pipeline stage and forecast close dates",
        "Maintain CRM records with accurate contact and deal info",
      ],
      askFirst: [
        "Offer a custom pricing package",
        "Extend a trial period beyond the standard",
        "Engage an enterprise prospect with non-standard requirements",
      ],
      neverDo: [
        "Share pricing with competitors",
        "Make commitments about features on the roadmap",
        "Provide legal or compliance guarantees",
        "Share one customer's data or usage with prospects",
      ],
      schedule: "business_hours",
      integrations: ["crm", "email", "calendar", "video_conferencing"],
    },
    {
      role: "Support",
      title: "Technical Support & Helpdesk",
      description: "Handles customer support tickets, troubleshoots common issues, and escalates complex problems to engineering.",
      canDo: [
        "Respond to support tickets within your SLA timeframe",
        "Troubleshoot common issues using your knowledge base",
        "Guide customers through setup, configuration, and usage",
        "Escalate bugs and technical issues to engineering with reproduction steps",
        "Track ticket volume, resolution time, and satisfaction scores",
        "Update knowledge base articles when new solutions are found",
      ],
      askFirst: [
        "Provide a workaround that involves data migration",
        "Offer a billing credit for service disruption",
        "Grant temporary elevated access for debugging",
      ],
      neverDo: [
        "Access customer data without authorization",
        "Make changes to production systems directly",
        "Share customer information between accounts",
        "Promise specific fix timelines for engineering issues",
      ],
      schedule: "continuous",
      integrations: ["helpdesk", "email", "chat", "slack"],
    },
    {
      role: "Onboarding",
      title: "Customer Onboarding",
      description: "Guides new customers through setup, configuration, and adoption to ensure they get value quickly.",
      canDo: [
        "Send welcome emails with setup guides and video tutorials",
        "Track onboarding checklist completion per customer",
        "Schedule and facilitate onboarding calls",
        "Monitor feature adoption and flag customers who are stuck",
        "Send tips and best practices emails during the first 30 days",
        "Collect early feedback and share with the product team",
      ],
      askFirst: [
        "Offer a custom onboarding session outside standard scope",
        "Extend the onboarding period for a struggling customer",
        "Involve engineering in a custom integration request",
      ],
      neverDo: [
        "Skip security or permission setup steps",
        "Import customer data without their explicit confirmation",
        "Make promises about features not yet built",
      ],
      schedule: "business_hours",
      integrations: ["email", "calendar", "crm", "product_analytics"],
    },
    {
      role: "Content",
      title: "Content & Documentation",
      description: "Maintains knowledge base articles, writes release notes, and creates help content for customers.",
      canDo: [
        "Write and update help center articles and FAQs",
        "Draft release notes for product updates",
        "Create step-by-step tutorials with screenshots",
        "Track which help articles get the most traffic",
        "Identify common support topics that need documentation",
        "Maintain a changelog of product updates",
      ],
      askFirst: [
        "Publish a blog post or case study",
        "Announce a major feature change to customers",
        "Write content about upcoming unreleased features",
      ],
      neverDo: [
        "Document internal architecture or security details publicly",
        "Share customer-specific implementations in public docs",
        "Publish without technical accuracy review",
      ],
      schedule: "business_hours",
      integrations: ["cms", "email", "helpdesk"],
    },
    {
      role: "Billing",
      title: "Subscription Billing & Revenue",
      description: "Manages subscription lifecycle, invoicing, payment failures, and revenue tracking.",
      canDo: [
        "Process subscription upgrades, downgrades, and cancellations",
        "Generate and send invoices per billing cycle",
        "Handle failed payment retries and dunning sequences",
        "Track MRR, churn, and expansion revenue",
        "Process refunds per your refund policy",
        "Generate monthly financial summary reports",
      ],
      askFirst: [
        "Offer a custom discount or pricing",
        "Process a refund outside the standard policy",
        "Extend a grace period on a failed payment beyond standard dunning",
      ],
      neverDo: [
        "Continue billing after a valid cancellation",
        "Modify subscription terms without customer consent",
        "Share revenue data or customer billing details externally",
      ],
      schedule: "business_hours",
      integrations: ["payments", "accounting", "crm", "email"],
    },
  ],

  hospitality: [
    {
      role: "Reservations",
      title: "Reservation Manager",
      description: "Handles booking inquiries, manages reservations across channels, and optimizes occupancy.",
      canDo: [
        "Process reservation requests from phone, email, and OTAs",
        "Send booking confirmations with property details and policies",
        "Handle modifications and cancellations per your policy",
        "Manage room inventory and availability across channels",
        "Send pre-arrival emails with check-in instructions",
        "Track occupancy rates and booking sources",
      ],
      askFirst: [
        "Override a cancellation policy for a guest",
        "Accept a booking during a blackout period",
        "Offer a rate lower than the published rate",
        "Accept a large group or event booking",
      ],
      neverDo: [
        "Overbook beyond safe capacity",
        "Share guest personal information with third parties",
        "Promise room upgrades without availability confirmation",
      ],
      schedule: "continuous",
      integrations: ["pms", "phone", "email", "channel_manager"],
    },
    {
      role: "Guest Services",
      title: "Guest Communication & Concierge",
      description: "Handles guest inquiries, provides local recommendations, and manages special requests to make stays memorable.",
      canDo: [
        "Answer questions about amenities, policies, and local area",
        "Coordinate special requests (extra pillows, early check-in, etc.)",
        "Provide restaurant and activity recommendations",
        "Handle noise complaints and basic issue resolution",
        "Send check-out reminders with instructions",
        "Collect mid-stay feedback to catch issues early",
      ],
      askFirst: [
        "Comp a night or amenity to resolve a complaint",
        "Arrange transportation or third-party services",
        "Move a guest to a different room",
      ],
      neverDo: [
        "Enter occupied rooms without proper notice",
        "Share guest stay information with anyone not on the reservation",
        "Guarantee specific room assignments before check-in",
      ],
      schedule: "continuous",
      integrations: ["pms", "sms", "email", "phone"],
    },
    {
      role: "Reviews",
      title: "Review & Reputation Manager",
      description: "Monitors reviews across booking platforms, responds to feedback, and identifies trends.",
      canDo: [
        "Send post-checkout review requests via email",
        "Monitor Airbnb, Booking.com, Google, and TripAdvisor reviews",
        "Respond to positive reviews with personalized thanks",
        "Draft responses to negative reviews for manager approval",
        "Track rating trends and recurring complaints",
        "Generate monthly reputation reports",
      ],
      askFirst: [
        "Offer compensation referenced in a review response",
        "Report a review as fraudulent to a platform",
        "Respond to a review alleging safety or legal issues",
      ],
      neverDo: [
        "Argue with guests in public responses",
        "Reveal details about other guests in responses",
        "Incentivize reviews with discounts or freebies",
      ],
      schedule: "business_hours",
      integrations: ["reviews", "email", "pms"],
    },
    {
      role: "Housekeeping",
      title: "Housekeeping Coordination",
      description: "Manages cleaning schedules, tracks room status, and coordinates turnover between guests.",
      canDo: [
        "Generate daily cleaning schedules based on check-in/check-out times",
        "Track room status (dirty, clean, inspected, occupied)",
        "Assign rooms to cleaning staff with priority ordering",
        "Flag maintenance issues found during cleaning",
        "Track supply inventory (linens, toiletries, cleaning products)",
        "Send 'room ready' notifications to front desk",
      ],
      askFirst: [
        "Skip cleaning on an occupied room at guest request",
        "Schedule deep cleaning that takes a room out of inventory",
        "Hire temporary cleaning staff for high-occupancy periods",
      ],
      neverDo: [
        "Enter rooms without following proper notification procedures",
        "Skip health and safety cleaning protocols",
        "Allow occupied rooms to go uncleaned without guest consent",
      ],
      schedule: "business_hours",
      integrations: ["pms", "sms", "inventory"],
    },
    {
      role: "Revenue",
      title: "Pricing & Revenue Optimization",
      description: "Monitors market rates, adjusts pricing for demand, and maximizes revenue per available room.",
      canDo: [
        "Track competitor rates daily for similar properties",
        "Suggest rate adjustments based on occupancy and demand",
        "Manage seasonal pricing calendars",
        "Track RevPAR, ADR, and occupancy metrics",
        "Identify low-demand periods and suggest promotions",
        "Generate weekly revenue performance reports",
      ],
      askFirst: [
        "Adjust rates more than 20% from the base rate",
        "Launch a promotional rate or package deal",
        "Set minimum stay requirements for peak periods",
      ],
      neverDo: [
        "Set rates below your minimum acceptable threshold",
        "Engage in price fixing with competitors",
        "Publish rates that don't include required taxes and fees",
      ],
      schedule: "business_hours",
      integrations: ["pms", "channel_manager", "accounting"],
    },
  ],

  creative: [
    {
      role: "Intake",
      title: "Project Inquiry & Intake",
      description: "Handles new project inquiries, collects project briefs, and qualifies potential clients.",
      canDo: [
        "Respond to project inquiries within 2 hours",
        "Collect project scope, timeline, budget, and goals",
        "Send your portfolio and case studies relevant to the inquiry",
        "Schedule discovery calls and initial consultations",
        "Qualify projects against your service offerings and capacity",
        "Maintain an inquiry pipeline with status tracking",
      ],
      askFirst: [
        "Quote a project outside your typical scope",
        "Accept a rush project that impacts existing commitments",
        "Refer a project to a partner agency",
      ],
      neverDo: [
        "Provide specific pricing without understanding full scope",
        "Commit to timelines without checking team availability",
        "Share client work or confidential briefs",
      ],
      schedule: "business_hours",
      integrations: ["email", "phone", "calendar", "crm"],
    },
    {
      role: "Project Management",
      title: "Project Coordination",
      description: "Manages active project timelines, coordinates deliverables, and keeps clients informed on progress.",
      canDo: [
        "Build and maintain project timelines with milestones",
        "Send weekly status updates to clients",
        "Track deliverables against deadlines and flag delays early",
        "Coordinate feedback rounds and revision tracking",
        "Manage asset and file organization per project",
        "Track project hours against budget",
      ],
      askFirst: [
        "Push back a client deadline",
        "Add scope to an active project (scope creep)",
        "Bring in a freelancer or subcontractor for overflow",
      ],
      neverDo: [
        "Deliver final files without quality review sign-off",
        "Share work-in-progress with unauthorized parties",
        "Modify project scope without contract amendment",
      ],
      schedule: "business_hours",
      integrations: ["project_management", "email", "file_storage"],
    },
    {
      role: "Billing",
      title: "Invoicing & Payment Tracking",
      description: "Manages project billing, milestone invoicing, and payment collection.",
      canDo: [
        "Generate invoices based on project milestones or retainer schedule",
        "Send invoices and payment reminders",
        "Track time and expenses per project",
        "Process payments and send receipts",
        "Track outstanding receivables and aging",
        "Generate monthly revenue reports by client and project",
      ],
      askFirst: [
        "Offer extended payment terms",
        "Apply a late fee to an overdue invoice",
        "Write off an uncollectable balance",
      ],
      neverDo: [
        "Begin work before deposit or contract is received",
        "Share pricing between clients",
        "Modify agreed rates without contract amendment",
      ],
      schedule: "business_hours",
      integrations: ["accounting", "email", "time_tracking", "payments"],
    },
    {
      role: "Social",
      title: "Social Media & Portfolio",
      description: "Manages your agency's social media presence, showcases work, and builds brand awareness.",
      canDo: [
        "Post completed project showcases and behind-the-scenes content",
        "Share industry insights and creative inspiration",
        "Engage with followers and respond to comments/DMs",
        "Update your online portfolio with new work",
        "Track social media growth and engagement metrics",
      ],
      askFirst: [
        "Share client work before the client has launched/announced",
        "Run a paid social campaign",
        "Enter your work in awards competitions",
      ],
      neverDo: [
        "Post client work without permission",
        "Disparage competitors or their work",
        "Reveal client budgets or business details",
      ],
      schedule: "business_hours",
      integrations: ["social_media", "website"],
    },
    {
      role: "Contracts",
      title: "Contracts & Legal Admin",
      description: "Manages contract templates, sends proposals, and tracks signed agreements and NDAs.",
      canDo: [
        "Generate proposals and contracts from templates",
        "Send contracts and NDAs for e-signature",
        "Track contract status and follow up on unsigned documents",
        "Maintain a library of current contract templates",
        "Track contract expiration dates for retainer clients",
        "Organize executed contracts in the client file",
      ],
      askFirst: [
        "Modify standard contract terms for a specific client",
        "Accept work without a signed contract",
        "Negotiate contract terms on behalf of the agency",
      ],
      neverDo: [
        "Provide legal advice about contract terms",
        "Execute contracts without authorized signatory",
        "Share contract details between clients",
      ],
      schedule: "business_hours",
      integrations: ["e_signature", "document_management", "email"],
    },
  ],

  nonprofit: [
    {
      role: "Donor Relations",
      title: "Donor Communication & Stewardship",
      description: "Manages donor relationships, sends acknowledgments, and maintains the donor database.",
      canDo: [
        "Send donation acknowledgment and tax receipts within 48 hours",
        "Maintain accurate donor records in your CRM",
        "Send personalized thank-you notes to major donors",
        "Track donor giving history and identify upgrade opportunities",
        "Send impact reports showing how donations were used",
        "Manage recurring donation processing and updates",
      ],
      askFirst: [
        "Reach out to a major donor prospect for the first time",
        "Send a solicitation to a lapsed donor",
        "Recognize a donor publicly",
      ],
      neverDo: [
        "Share donor information with other organizations",
        "Misrepresent how donations will be used",
        "Accept donations with inappropriate strings attached",
      ],
      schedule: "business_hours",
      integrations: ["crm", "email", "payments", "accounting"],
    },
    {
      role: "Fundraising",
      title: "Fundraising Campaign Manager",
      description: "Runs email fundraising campaigns, manages event registrations, and tracks campaign performance.",
      canDo: [
        "Build and send fundraising email campaigns",
        "Track campaign performance (open rates, conversion, total raised)",
        "Manage event registrations and ticket sales",
        "Send campaign updates and progress toward goals",
        "Segment donors by giving level for targeted appeals",
        "Generate campaign performance reports",
      ],
      askFirst: [
        "Launch a major fundraising campaign or appeal",
        "Set a public fundraising goal",
        "Partner with a corporate sponsor",
      ],
      neverDo: [
        "Overstate the urgency or impact of a campaign",
        "Use donor funds for unapproved purposes",
        "Send fundraising appeals to opted-out contacts",
      ],
      schedule: "business_hours",
      integrations: ["email_marketing", "crm", "payments", "website"],
    },
    {
      role: "Volunteers",
      title: "Volunteer Coordination",
      description: "Recruits, schedules, and communicates with volunteers for programs and events.",
      canDo: [
        "Process volunteer applications and onboarding paperwork",
        "Schedule volunteers for shifts and events",
        "Send shift reminders and instructions",
        "Track volunteer hours for recognition and reporting",
        "Manage volunteer communications and newsletters",
        "Match volunteer skills to organizational needs",
      ],
      askFirst: [
        "Place a volunteer in a role requiring background check",
        "Dismiss or restrict a volunteer",
        "Accept a corporate volunteer group",
      ],
      neverDo: [
        "Place volunteers in unsafe situations",
        "Share volunteer personal information externally",
        "Allow volunteers to perform duties requiring paid staff credentials",
      ],
      schedule: "business_hours",
      integrations: ["crm", "email", "sms", "calendar"],
    },
    {
      role: "Grants",
      title: "Grant Tracking & Reporting",
      description: "Tracks grant deadlines, compiles reporting data, and manages grant compliance documentation.",
      canDo: [
        "Maintain a calendar of grant deadlines and reporting dates",
        "Compile program data for grant reports",
        "Track grant expenditures against budget",
        "Send deadline reminders 30 and 7 days in advance",
        "Organize grant documentation and correspondence",
        "Generate grant compliance status reports",
      ],
      askFirst: [
        "Submit a grant report to a funder",
        "Request a grant modification or extension",
        "Apply for a new grant opportunity",
      ],
      neverDo: [
        "Misreport program outcomes or financials",
        "Reallocate grant funds without funder approval",
        "Miss grant reporting deadlines",
      ],
      schedule: "business_hours",
      integrations: ["document_management", "accounting", "email"],
    },
    {
      role: "Communications",
      title: "Public Communications & Social Media",
      description: "Manages your nonprofit's public presence, social media, newsletters, and community outreach.",
      canDo: [
        "Post program highlights and impact stories to social media",
        "Send monthly newsletters to supporters",
        "Update your website with current programs and events",
        "Respond to media inquiries with approved talking points",
        "Track social media engagement and email open rates",
      ],
      askFirst: [
        "Issue a press release or public statement",
        "Share stories involving program participants",
        "Take a position on a public issue or policy",
      ],
      neverDo: [
        "Share participant personal information publicly",
        "Make political endorsements on behalf of the organization",
        "Publish financial details without board approval",
      ],
      schedule: "business_hours",
      integrations: ["social_media", "email_marketing", "website"],
    },
  ],

  agriculture: [
    {
      role: "Sales",
      title: "Sales & Order Management",
      description: "Handles customer orders, manages wholesale accounts, and coordinates direct-to-consumer sales.",
      canDo: [
        "Process incoming orders from wholesale and retail customers",
        "Send order confirmations and delivery schedules",
        "Manage farmers market and CSA subscription lists",
        "Track customer order history and preferences",
        "Send seasonal availability updates to buyers",
        "Generate weekly sales and order volume reports",
      ],
      askFirst: [
        "Offer volume discount pricing",
        "Accept an order larger than current inventory",
        "Onboard a new wholesale account",
      ],
      neverDo: [
        "Guarantee crop availability subject to weather",
        "Accept orders for products you don't grow or produce",
        "Share pricing between competing buyers",
      ],
      schedule: "business_hours",
      integrations: ["email", "phone", "pos", "accounting"],
    },
    {
      role: "Logistics",
      title: "Harvest & Delivery Coordination",
      description: "Coordinates harvest schedules, manages delivery routes, and ensures timely order fulfillment.",
      canDo: [
        "Build weekly harvest and delivery schedules",
        "Coordinate delivery routes for efficiency",
        "Send delivery confirmations and ETA updates to buyers",
        "Track delivery completion and collect proof of delivery",
        "Manage cold chain requirements and temperature logging",
        "Schedule equipment and labor for harvest days",
      ],
      askFirst: [
        "Change a standing delivery schedule for a key account",
        "Arrange third-party transportation",
        "Delay a delivery due to quality concerns",
      ],
      neverDo: [
        "Deliver product that hasn't passed quality inspection",
        "Share delivery route information with competitors",
        "Override food safety temperature requirements",
      ],
      schedule: "business_hours",
      integrations: ["calendar", "maps", "sms", "email"],
    },
    {
      role: "Inventory",
      title: "Crop & Supply Inventory",
      description: "Tracks crop yields, supply inventory, and input materials to keep operations running smoothly.",
      canDo: [
        "Track current crop inventory by variety and quantity",
        "Monitor supply levels for seeds, fertilizer, and feed",
        "Send reorder alerts for inputs hitting low thresholds",
        "Log harvest yields and compare to forecasts",
        "Track equipment fuel and supply usage",
        "Generate monthly inventory and yield reports",
      ],
      askFirst: [
        "Order supplies above $3,000",
        "Switch to a new input supplier or brand",
        "Write off crop loss due to weather or pest damage",
      ],
      neverDo: [
        "Misreport yield data for insurance or compliance",
        "Order restricted chemicals without proper licensing",
        "Share proprietary growing data with competitors",
      ],
      schedule: "business_hours",
      integrations: ["inventory", "accounting", "email"],
    },
    {
      role: "Compliance",
      title: "Compliance & Certification Tracker",
      description: "Tracks organic certifications, food safety compliance, and regulatory documentation.",
      canDo: [
        "Track certification renewal dates and requirements",
        "Maintain food safety plan documentation",
        "Log required inspection records and test results",
        "Send renewal reminders 90 and 30 days before expiration",
        "Organize compliance documentation for audits",
        "Track pesticide and chemical application records",
      ],
      askFirst: [
        "Submit certification applications or renewals",
        "Respond to regulatory inquiries or inspections",
        "Implement changes to food safety protocols",
      ],
      neverDo: [
        "Falsify compliance or inspection records",
        "Allow sales of non-compliant product",
        "Destroy required compliance documentation",
      ],
      schedule: "business_hours",
      integrations: ["document_management", "email", "calendar"],
    },
    {
      role: "Marketing",
      title: "Farm Marketing & Community",
      description: "Manages your farm's brand, social media, CSA communications, and community engagement.",
      canDo: [
        "Post farm updates, harvest photos, and recipes to social media",
        "Send weekly CSA newsletters with box contents and farm news",
        "Manage farmers market schedule and event promotions",
        "Update your website with seasonal availability",
        "Build email campaigns for u-pick days and farm events",
      ],
      askFirst: [
        "Run a paid advertising campaign",
        "Partner with a restaurant or retailer for promotion",
        "Announce a new product line or service",
      ],
      neverDo: [
        "Misrepresent growing practices or certifications",
        "Post photos of employees without consent",
        "Make health claims about products beyond what's allowed",
      ],
      schedule: "business_hours",
      integrations: ["social_media", "email_marketing", "website"],
    },
  ],
});


// ─── Generic fallback team ───────────────────────────────────────────────────

const GENERIC_TEAM = [
  {
    role: "Communication",
    title: "Customer Communication Hub",
    description: "Handles all incoming customer calls, emails, and messages. First point of contact for your business.",
    canDo: [
      "Answer incoming calls and respond to emails within 15 minutes",
      "Provide information about your services, hours, and location",
      "Take messages and route to the right person",
      "Handle basic customer inquiries and FAQs",
      "Send follow-up communications after customer interactions",
    ],
    askFirst: [
      "Handle a customer complaint",
      "Provide pricing or quotes",
      "Make commitments on behalf of the business",
    ],
    neverDo: [
      "Share customer information with third parties",
      "Make promises the business can't keep",
      "Provide professional advice outside your domain",
    ],
    schedule: "continuous",
    integrations: ["phone", "email", "sms"],
  },
  {
    role: "Scheduling",
    title: "Appointment & Calendar Manager",
    description: "Manages your calendar, books appointments, and sends reminders to reduce no-shows.",
    canDo: [
      "Book and confirm appointments",
      "Send reminders 24 hours and 2 hours before appointments",
      "Handle rescheduling and cancellation requests",
      "Maintain a waitlist for popular time slots",
      "Block personal time and breaks on the calendar",
    ],
    askFirst: [
      "Double-book a time slot",
      "Schedule outside business hours",
      "Accept appointments more than 30 days out",
    ],
    neverDo: [
      "Cancel appointments without notifying customers",
      "Share your schedule publicly",
      "Overbook beyond your capacity",
    ],
    schedule: "business_hours",
    integrations: ["calendar", "email", "sms"],
  },
  {
    role: "Billing",
    title: "Invoicing & Payment Tracking",
    description: "Sends invoices, tracks payments, and follows up on outstanding balances.",
    canDo: [
      "Generate and send invoices after service completion",
      "Track payment status and send payment reminders",
      "Record payments received and reconcile accounts",
      "Generate monthly accounts receivable reports",
      "Provide customers with payment history when requested",
    ],
    askFirst: [
      "Offer a payment plan",
      "Apply a discount to an invoice",
      "Write off an unpaid balance",
      "Send a final collections notice",
    ],
    neverDo: [
      "Modify pricing without authorization",
      "Share financial data with unauthorized parties",
      "Process refunds without approval",
    ],
    schedule: "business_hours",
    integrations: ["accounting", "email", "payments"],
  },
  {
    role: "Marketing",
    title: "Marketing & Reviews",
    description: "Manages your online presence, requests reviews, and runs basic marketing campaigns.",
    canDo: [
      "Request reviews from satisfied customers after service",
      "Monitor and respond to online reviews",
      "Post updates and promotions to social media weekly",
      "Send email campaigns to past customers",
      "Update your Google Business Profile",
    ],
    askFirst: [
      "Run a paid advertising campaign",
      "Offer a promotion or discount",
      "Partner with another business for marketing",
    ],
    neverDo: [
      "Post fake reviews",
      "Make false claims about your business",
      "Send marketing to opted-out contacts",
    ],
    schedule: "business_hours",
    integrations: ["social_media", "email", "reviews"],
  },
];


// ─── Integration catalog ────────────────────────────────────────────────────

const INTEGRATION_CATALOG = Object.freeze({
  phone:                { name: "Phone System",               provider: "Twilio",             required: true,  available: false },
  email:                { name: "Email",                      provider: "Gmail",              required: true,  available: true  },
  sms:                  { name: "Text Messaging",             provider: "Twilio",             required: true,  available: false },
  calendar:             { name: "Calendar",                   provider: "Google Calendar",    required: true,  available: true  },
  chat:                 { name: "Live Chat",                  provider: "Intercom",           required: false, available: false },
  accounting:           { name: "Accounting",                 provider: "QuickBooks",         required: false, available: false },
  payments:             { name: "Payment Processing",         provider: "Stripe",             required: false, available: false },
  crm:                  { name: "CRM",                        provider: "HubSpot",            required: false, available: false },
  reviews:              { name: "Review Platform",            provider: "Google Business",    required: false, available: false },
  social_media:         { name: "Social Media",               provider: "Meta Business Suite",required: false, available: false },
  email_marketing:      { name: "Email Marketing",            provider: "Mailchimp",          required: false, available: false },
  website:              { name: "Website",                     provider: "WordPress",          required: false, available: false },
  inventory:            { name: "Inventory Management",       provider: "inFlow",             required: false, available: false },
  pos:                  { name: "Point of Sale",              provider: "Square",             required: false, available: false },
  maps:                 { name: "Maps & Routing",             provider: "Google Maps",        required: false, available: false },
  video_conferencing:   { name: "Video Conferencing",         provider: "Zoom",               required: false, available: false },
  helpdesk:             { name: "Help Desk",                  provider: "Zendesk",            required: false, available: false },
  slack:                { name: "Team Communication",         provider: "Slack",              required: false, available: true  },
  document_management:  { name: "Document Management",        provider: "Google Drive",       required: false, available: false },
  e_signature:          { name: "E-Signature",                provider: "DocuSign",           required: false, available: false },
  file_storage:         { name: "File Storage",               provider: "Google Drive",       required: false, available: false },
  time_tracking:        { name: "Time Tracking",              provider: "Toggl",              required: false, available: false },
  project_management:   { name: "Project Management",         provider: "Asana",              required: false, available: false },
  scheduling:           { name: "Staff Scheduling",           provider: "When I Work",        required: false, available: false },
  reservations:         { name: "Reservations",               provider: "OpenTable",          required: false, available: false },
  delivery_platforms:   { name: "Delivery Platforms",         provider: "DoorDash / UberEats",required: false, available: false },
  ecommerce_platform:   { name: "E-Commerce Platform",       provider: "Shopify",            required: false, available: false },
  shipping:             { name: "Shipping",                   provider: "ShipStation",        required: false, available: false },
  ehr:                  { name: "Electronic Health Records",  provider: "Practice Fusion",    required: false, available: false },
  insurance_verification:{ name: "Insurance Verification",    provider: "Availity",           required: false, available: false },
  fax:                  { name: "Fax",                        provider: "eFax",               required: false, available: false },
  mls:                  { name: "MLS Access",                 provider: "Local MLS",          required: false, available: false },
  channel_manager:      { name: "Channel Manager",            provider: "Guesty",             required: false, available: false },
  pms:                  { name: "Property Management System", provider: "Cloudbeds",          required: false, available: false },
  shop_management:      { name: "Shop Management",            provider: "Shop-Ware",          required: false, available: false },
  parts_suppliers:      { name: "Parts Suppliers",            provider: "AutoZone / NAPA",    required: false, available: false },
  tms:                  { name: "Transportation Management",  provider: "Samsara",            required: false, available: false },
  eld:                  { name: "Electronic Logging Device",  provider: "KeepTruckin",        required: false, available: false },
  load_boards:          { name: "Load Boards",                provider: "DAT / Truckstop",    required: false, available: false },
  student_management:   { name: "Student Management System",  provider: "Teachable",          required: false },
  membership_software:  { name: "Membership Software",        provider: "Mindbody",           required: false },
  booking_software:     { name: "Booking Software",           provider: "Vagaro",             required: false },
  cms:                  { name: "Content Management",         provider: "Notion",             required: false },
  product_analytics:    { name: "Product Analytics",          provider: "Mixpanel",           required: false },
});


// ─── ROI estimates by industry ───────────────────────────────────────────────

const ROI_DATA = Object.freeze({
  home_services:        { hoursPerWeek: 18, monthlyCostRange: "$12-25",  hiringEquiv: "$2,800/month", topSaver: "Phone answering & scheduling (est. 10 hrs/week)" },
  restaurant:           { hoursPerWeek: 22, monthlyCostRange: "$15-30",  hiringEquiv: "$3,200/month", topSaver: "Reservation & order management (est. 12 hrs/week)" },
  retail:               { hoursPerWeek: 12, monthlyCostRange: "$10-20",  hiringEquiv: "$2,200/month", topSaver: "Customer inquiries & inventory tracking (est. 6 hrs/week)" },
  ecommerce:            { hoursPerWeek: 25, monthlyCostRange: "$15-30",  hiringEquiv: "$3,500/month", topSaver: "Customer support & order tracking (est. 14 hrs/week)" },
  professional_services:{ hoursPerWeek: 20, monthlyCostRange: "$15-30",  hiringEquiv: "$3,800/month", topSaver: "Client intake & scheduling (est. 10 hrs/week)" },
  healthcare:           { hoursPerWeek: 22, monthlyCostRange: "$15-30",  hiringEquiv: "$3,400/month", topSaver: "Patient scheduling & insurance verification (est. 12 hrs/week)" },
  real_estate:          { hoursPerWeek: 16, monthlyCostRange: "$12-25",  hiringEquiv: "$3,000/month", topSaver: "Lead follow-up & showing coordination (est. 8 hrs/week)" },
  automotive:           { hoursPerWeek: 15, monthlyCostRange: "$12-25",  hiringEquiv: "$2,600/month", topSaver: "Service appointment booking & status updates (est. 8 hrs/week)" },
  fitness:              { hoursPerWeek: 14, monthlyCostRange: "$10-20",  hiringEquiv: "$2,400/month", topSaver: "Member sign-ups & class booking (est. 7 hrs/week)" },
  beauty:               { hoursPerWeek: 15, monthlyCostRange: "$10-20",  hiringEquiv: "$2,400/month", topSaver: "Appointment booking & reminders (est. 8 hrs/week)" },
  construction:         { hoursPerWeek: 18, monthlyCostRange: "$12-25",  hiringEquiv: "$3,200/month", topSaver: "Project admin & scheduling coordination (est. 10 hrs/week)" },
  trucking:             { hoursPerWeek: 20, monthlyCostRange: "$15-30",  hiringEquiv: "$3,600/month", topSaver: "Dispatch & compliance tracking (est. 12 hrs/week)" },
  education:            { hoursPerWeek: 14, monthlyCostRange: "$10-20",  hiringEquiv: "$2,400/month", topSaver: "Enrollment inquiries & scheduling (est. 7 hrs/week)" },
  tech:                 { hoursPerWeek: 22, monthlyCostRange: "$15-30",  hiringEquiv: "$4,200/month", topSaver: "Customer support & onboarding (est. 12 hrs/week)" },
  hospitality:          { hoursPerWeek: 20, monthlyCostRange: "$15-30",  hiringEquiv: "$3,200/month", topSaver: "Reservation management & guest communication (est. 10 hrs/week)" },
  creative:             { hoursPerWeek: 16, monthlyCostRange: "$12-25",  hiringEquiv: "$3,000/month", topSaver: "Project intake & client communication (est. 8 hrs/week)" },
  nonprofit:            { hoursPerWeek: 15, monthlyCostRange: "$10-20",  hiringEquiv: "$2,600/month", topSaver: "Donor communication & volunteer coordination (est. 8 hrs/week)" },
  agriculture:          { hoursPerWeek: 14, monthlyCostRange: "$10-20",  hiringEquiv: "$2,400/month", topSaver: "Order management & delivery coordination (est. 7 hrs/week)" },
  _default:             { hoursPerWeek: 15, monthlyCostRange: "$12-25",  hiringEquiv: "$2,400/month", topSaver: "Phone answering & scheduling (est. 8 hrs/week)" },
});


// ─────────────────────────────────────────────────────────────────────────────
// identifyIndustry(description)
// ─────────────────────────────────────────────────────────────────────────────

export function identifyIndustry(description) {
  if (!description || typeof description !== "string") {
    return {
      industry: null,
      subIndustry: null,
      confidence: 0,
      businessSize: "small",
      location: null,
      keywords: [],
    };
  }

  const text = description.toLowerCase();

  // --- Score each industry ---
  const scores = {};
  const matchedKeywords = {};

  for (const [industryId, industry] of Object.entries(INDUSTRY_TAXONOMY)) {
    let score = 0;
    const hits = [];

    for (const keyword of industry.keywords) {
      // Use word-boundary matching to avoid partial matches
      // e.g. "shop" should not match inside "Shopify"
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp("\\b" + escaped + "\\b");
      if (regex.test(text)) {
        // Multi-word keywords are worth more (more specific)
        const words = keyword.split(" ").length;
        score += words;
        hits.push(keyword);
      }
    }

    if (score > 0) {
      scores[industryId] = score;
      matchedKeywords[industryId] = hits;
    }
  }

  // --- Pick the best match ---
  let bestIndustry = null;
  let bestScore = 0;

  for (const [industryId, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestIndustry = industryId;
    }
  }

  // --- Determine sub-industry ---
  let subIndustry = null;

  if (bestIndustry) {
    const subs = INDUSTRY_TAXONOMY[bestIndustry].subIndustries;
    let bestSubScore = 0;

    for (const [subId, subKeywords] of Object.entries(subs)) {
      let subScore = 0;
      for (const kw of subKeywords) {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp("\\b" + escaped + "\\b");
        if (regex.test(text)) {
          subScore += kw.split(" ").length;
        }
      }
      if (subScore > bestSubScore) {
        bestSubScore = subScore;
        subIndustry = subId;
      }
    }
  }

  // --- Confidence ---
  // Based on how many keywords matched and how specific they were
  let confidence = 0;
  if (bestScore >= 5) confidence = 0.95;
  else if (bestScore >= 3) confidence = 0.9;
  else if (bestScore >= 2) confidence = 0.8;
  else if (bestScore >= 1) confidence = 0.6;

  // --- Business size ---
  const businessSize = detectBusinessSize(text);

  // --- Location ---
  const location = detectLocation(description);

  // --- Keyword list ---
  const keywords = bestIndustry ? matchedKeywords[bestIndustry] : [];

  return {
    industry: bestIndustry,
    subIndustry,
    confidence,
    businessSize,
    location,
    keywords,
  };
}


// ─── Helper: detect business size from description ───────────────────────────

function detectBusinessSize(text) {
  // Look for patterns like "5 employees", "15 techs", "team of 20", "50 people"
  const patterns = [
    // "N keyword" — e.g. "5 employees"
    /(\d+)\s+(?:employees|people|staff|workers|technicians|techs|drivers|agents|stylists|therapists|mechanics|guys|members|contractors|crew|associates|person\b|team\s*members)/i,
    // "team of N"
    /team\s+of\s+(\d+)/i,
    // "N-person" — e.g. "5-person team"
    /(\d+)[- ]person/i,
    // "about/around/roughly N"
    /(?:about|around|roughly|approximately)\s+(\d+)\s+(?:employees|people|staff|workers|techs|drivers)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const count = parseInt(match[1], 10);
      if (count < 5) return "tiny";
      if (count <= 20) return "small";
      if (count <= 100) return "medium";
      return "large";
    }
  }

  // Look for qualitative size indicators
  if (/\b(?:solo|just me|one[- ]man|one[- ]woman|solopreneur|freelance)\b/i.test(text)) return "tiny";
  if (/\b(?:enterprise|corporation|corporate|national|hundreds)\b/i.test(text)) return "large";
  if (/\b(?:mid[- ]?size|midsize|regional|dozens|growing fast)\b/i.test(text)) return "medium";

  return "small"; // default
}


// ─── Helper: detect location from description ────────────────────────────────

function detectLocation(description) {
  // Try cities first (more specific)
  for (const city of US_CITIES) {
    if (description.toLowerCase().includes(city.toLowerCase())) {
      return city;
    }
  }

  // Try state names
  for (const state of US_STATES) {
    // Use word boundary matching to avoid "Virginia" matching inside "West Virginia" etc.
    const regex = new RegExp("\\b" + state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
    if (regex.test(description)) {
      return state;
    }
  }

  // Try state abbreviations (only when they look intentional — after a comma or "in")
  for (const abbr of STATE_ABBREVIATIONS) {
    const regex = new RegExp("(?:,\\s*|\\bin\\s+)" + abbr + "\\b");
    if (regex.test(description)) {
      return abbr;
    }
  }

  return null;
}


// ─────────────────────────────────────────────────────────────────────────────
// proposeTeam(industryResult)
// ─────────────────────────────────────────────────────────────────────────────

export function proposeTeam(industryResult) {
  if (!industryResult || !industryResult.industry) {
    return {
      teamName: "Your Business Team",
      workers: GENERIC_TEAM,
    };
  }

  const { industry, subIndustry, location } = industryResult;
  const template = TEAM_TEMPLATES[industry];

  if (!template) {
    return {
      teamName: buildTeamName(industryResult),
      workers: GENERIC_TEAM,
    };
  }

  return {
    teamName: buildTeamName(industryResult),
    workers: template,
  };
}


// ─── Helper: build a team name from the industry result ──────────────────────

function buildTeamName(industryResult) {
  const parts = [];

  if (industryResult.location) {
    parts.push(industryResult.location);
  }

  // Use subIndustry label if we have one, otherwise industry label
  const taxonomy = INDUSTRY_TAXONOMY[industryResult.industry];
  if (taxonomy) {
    if (industryResult.subIndustry) {
      // Capitalize sub-industry ID: "plumbing" -> "Plumbing"
      const subLabel = industryResult.subIndustry
        .split("_")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      parts.push(subLabel);
    } else {
      parts.push(taxonomy.label);
    }
  }

  parts.push("Team");

  return parts.join(" ");
}


// ─────────────────────────────────────────────────────────────────────────────
// identifyIntegrations(workers)
// ─────────────────────────────────────────────────────────────────────────────

export function identifyIntegrations(workers) {
  if (!workers || !Array.isArray(workers) || workers.length === 0) {
    return [];
  }

  // Collect all unique integration IDs and track which worker needs them
  const integrationMap = new Map(); // id -> Set of worker roles that need it

  for (const worker of workers) {
    if (!worker.integrations) continue;
    for (const intId of worker.integrations) {
      if (!integrationMap.has(intId)) {
        integrationMap.set(intId, new Set());
      }
      integrationMap.get(intId).add(worker.role);
    }
  }

  // Build the output
  const result = [];

  for (const [id, roles] of integrationMap) {
    const catalogEntry = INTEGRATION_CATALOG[id];
    if (!catalogEntry) continue;

    const roleList = Array.from(roles);
    const primaryRole = roleList[0];
    const why = roleList.length === 1
      ? `So ${primaryRole} can do its job`
      : `Used by ${roleList.join(", ")}`;

    result.push({
      id,
      name: catalogEntry.name,
      why,
      provider: catalogEntry.provider,
      required: catalogEntry.required,
      available: catalogEntry.available === true,
    });
  }

  // Sort: required first, then alphabetical
  result.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}


// ─────────────────────────────────────────────────────────────────────────────
// estimateROI(industryResult, workers)
// ─────────────────────────────────────────────────────────────────────────────

export function estimateROI(industryResult, workers) {
  const industryId = industryResult?.industry || "_default";
  const data = ROI_DATA[industryId] || ROI_DATA._default;

  // Scale slightly by business size
  let sizeMultiplier = 1.0;
  if (industryResult?.businessSize === "tiny") sizeMultiplier = 0.7;
  else if (industryResult?.businessSize === "medium") sizeMultiplier = 1.3;
  else if (industryResult?.businessSize === "large") sizeMultiplier = 1.6;

  // Scale slightly by number of workers
  const workerCount = workers?.length || 4;
  const workerMultiplier = workerCount / 5; // normalized around 5 workers

  const rawHours = data.hoursPerWeek * sizeMultiplier * workerMultiplier;
  const estimatedHours = Math.round(rawHours);

  return {
    estimatedHoursSavedPerWeek: estimatedHours,
    estimatedMonthlyCost: data.monthlyCostRange,
    equivalentHiringCost: data.hiringEquiv,
    topTimeSaver: data.topSaver,
  };
}
