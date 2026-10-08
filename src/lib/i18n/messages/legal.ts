import { defineMessages } from '@/lib/i18n/define';

/**
 * The legal documents (terms, privacy, refunds, acceptable use) in Arabic and English. DRAFTS for
 * the owner's counsel: every `{confirm}` marks a clause that needs a legal decision.
 *
 * Section bodies are tiny markup, rendered by `components/legal/legal-text.tsx`:
 *  - a blank line starts a paragraph; `- ` starts a list item; `### ` is a sub-heading
 *  - `**bold**`, `[label](/path)` (internal pages listed in `LEGAL_LINK_TARGETS` only) and
 *    `[[code]]` for technical names
 *  - `{companyName} {companyAddress} {companyCr} {vatNumber} {contactEmail} {supportEmail}` are
 *    the company details from the environment (a marked placeholder while unset), `{confirm}`
 *    is the "to confirm" flag (shown while `LEGAL_DRAFT`), and `{vatPercent} {leadDays}
 *    {graceDays} {refundDays}` are numbers filled from the billing and legal configuration.
 *
 * The order of the keys under `sections` is the order on the page and in the table of contents;
 * the key (camelCase) becomes the anchor (`yourContent` -> `#your-content`).
 */
export default defineMessages({
  en: {
    common: {
      eyebrow: 'Legal',
      lastUpdated: 'Last updated {date}',
      tocLabel: 'On this page',
      related: 'Other legal documents',
      draft: {
        title: 'Draft — pending legal review',
        body: 'This document is a template that a lawyer has not reviewed yet. It is not legal advice and it is not final. Highlighted items in brackets are company details that still have to be provided, and "To confirm" flags mark wording that needs a decision.',
      },
      placeholder: {
        missing: '[{label}: to be provided]',
        companyName: 'Company name',
        companyAddress: 'Company address',
        companyCr: 'Commercial registration number',
        vatNumber: 'VAT number',
        contactEmail: 'Contact email',
        supportEmail: 'Support email',
      },
      confirm: {
        short: 'To confirm',
        long: 'This wording needs to be confirmed by legal counsel',
      },
    },
    nav: {
      terms: 'Terms of Service',
      privacy: 'Privacy Policy',
      refunds: 'Refund Policy',
      acceptableUse: 'Acceptable Use Policy',
    },
    footer: {
      title: 'Legal',
    },
    consent: {
      line: 'By creating an account, you agree to the {terms} and the {privacy}.',
      newTab: 'opens in a new tab',
    },
    terms: {
      meta: {
        title: 'Terms of Service',
        description:
          'The terms that apply when you use AIVORE to generate images and video, buy credits and subscribe to a plan.',
      },
      title: 'Terms of Service',
      summary:
        'These terms explain how you may use AIVORE, how credits and plans work, and what each of us can expect from the other. Please read them before you create an account.',
      sections: {
        about: {
          title: 'Who we are and what these terms are',
          body: `AIVORE is an online service for creating images and video from text and pictures, in Arabic or English ("the Service"). It is operated by the company below ("we", "us").

- Company: {companyName}
- Commercial registration number: {companyCr}
- VAT number: {vatNumber}
- Address: {companyAddress}
- Contact: {contactEmail}
- Support: {supportEmail}

By creating an account or using the Service you agree to these Terms of Service and to our [Privacy Policy](/privacy), [Refund Policy](/refunds) and [Acceptable Use Policy](/acceptable-use), which are part of them. If you do not agree, please do not use the Service.

If you use the Service for a business or another organisation, you confirm that you may bind it to these terms.`,
        },
        account: {
          title: 'Your account',
          body: `You must be at least 18 years old, or have the legal capacity to enter a contract where you live, to create an account {confirm}.

Give us accurate details and keep them up to date. Keep your password and API keys secret: you are responsible for what happens under your account until you tell us it has been compromised. Tell us straight away at {supportEmail} if you think someone else has access.

Create one account for yourself. Opening several accounts to collect free sign-up credits, or using disposable email addresses for that, is not allowed, and we may refuse or close such accounts.

We may ask you to confirm your email address before you can generate content. We may also suspend an account that we reasonably believe has been compromised or used against these terms.`,
        },
        service: {
          title: 'The Service',
          body: `The Service turns the prompts and images you provide into new images and videos using artificial intelligence models, some of which are run by third-party providers. We may add, change or remove models, tools, features and prices as the technology and our costs change.

We work to keep the Service available, but we do not promise that it will be uninterrupted or error-free. Generation depends on third-party providers, so a request can fail or take longer than expected. Demo models, where offered, are for trying the Service and produce placeholder results.

We may set limits for fairness and safety, for example on how many generations can run at once, file sizes and request rates.`,
        },
        credits: {
          title: 'Credits',
          body: `Generating content costs credits. The cost of a request is shown in the studio before you submit it, and it is taken from your balance when the request is accepted.

- **Credits never expire.** Unused credits stay in your account for as long as the account exists.
- Credits have no cash value. They cannot be transferred, sold, gifted or exchanged for money, except for the refunds described in the [Refund Policy](/refunds).
- If a generation fails, or you cancel it before it finishes, the credits it cost are returned to your balance automatically. If a request returns fewer results than you paid for, the credits for the missing results are returned.
- Free credits we give you, for example when you sign up, are a gift. We may change or end such offers at any time, and they cannot be refunded as money.
- Your balance and its history (purchases, usage and refunds) are shown in your [account](/account).

We may correct a balance that is wrong because of a technical error, and we may remove credits that were obtained through abuse or fraud.`,
        },
        plans: {
          title: 'Credit packs, plans and payments',
          body: `You can buy credits in two ways: one-time credit packs, and monthly plans that add a set number of credits for each month you pay for. The credits, the price and what you get are shown before you pay.

### Prices and taxes
Prices are in Saudi riyals (SAR) and include value added tax at {vatPercent}%. The price shown when you start checkout is the price you pay. If you need a tax invoice for a purchase, write to {supportEmail} {confirm}.

### Payments
Payments are processed by our payment provider, Moyasar, on its own secure payment page. Your card details are entered there and are never sent to or stored by us. Credits are added to your account once the payment provider has confirmed the payment.

### Monthly plans
- A plan gives you a fixed number of credits for each month you pay for. Credits you have already received are yours and stay in your account, even if you later stop paying.
- A plan does not charge your card automatically. About {leadDays} days before the end of a paid month we issue a payment link for the next month, which you will find in your account. The plan renews, and its monthly credits are added, when you pay that link.
- If a month ends without payment, the plan becomes past due. You can still pay for {graceDays} more days; after that the plan ends and the link stops working.
- You can cancel at any time in your account. The plan then stops at the end of the month you have already paid for, and we ask for no further payment. We do not refund the current month when you cancel, unless the [Refund Policy](/refunds) says otherwise.
- You can have one active plan at a time.

### Price changes
We may change prices, credit amounts and plans. A change applies to purchases made after it takes effect, and to the next renewal of a plan once we have told you about it by email or in the Service {confirm}. You can cancel before a new price applies to you.`,
        },
        outputs: {
          title: 'AI-generated content',
          body: `Results are produced by AI models and cannot be predicted. Please keep in mind that:

- Outputs may be inaccurate, unexpected, of low quality or offensive, and may not match your description. They may also look similar or identical to outputs other people receive, or to existing works.
- We do not check outputs for accuracy, originality or legal clearance. You are responsible for reviewing them before you use or publish them.
- AI-generated content may not be protected by copyright or similar rights in some countries.
- Do not rely on the Service for professional, medical, legal or financial advice, or for decisions that affect people's safety or rights.

### Who owns outputs
As between you and us, and to the extent the law allows, you own the outputs you generate, and we do not claim ownership of them. This is subject to these terms, to the rights of other people, and to the terms of the third-party model providers whose models create the output {confirm}. We do not promise that an output is free of third-party rights.

### Your responsibility
You are responsible for the prompts and images you submit and for how you use and share outputs. You must have the right to use the images you upload, and you must follow the [Acceptable Use Policy](/acceptable-use). When you publish an output you are responsible for any disclosure that the law or the platform you publish on requires, for example that it was made with AI.`,
        },
        yourContent: {
          title: 'Your content and sharing',
          body: `"Your content" means the prompts, settings and images you submit and the outputs you generate. You keep your rights in it.

You give us a limited, worldwide, non-exclusive licence to store, process, transmit and display your content, and to pass it to our service providers, only as needed to run the Service for you, to keep it safe, and to follow the law. This licence ends when your content is deleted, except for copies that remain in backups for a limited time {confirm} or that we must keep by law.

Your generations are private by default. If you choose to make one public, anyone can see it on the Explore page and through its share link, together with the name on your account. You can make it private again or delete it at any time; copies that others have already saved are outside our control.

We do not use your prompts, images or outputs to train our own AI models {confirm}. Our generation providers handle your content under their own terms; see the [Privacy Policy](/privacy).`,
        },
        acceptableUse: {
          title: 'Acceptable use',
          body: `You must use the Service lawfully and follow our [Acceptable Use Policy](/acceptable-use). In particular, you must not create, upload or share:

- sexual content involving minors, or sexual or nude images of real people made without their consent;
- content that impersonates a real person or deceives others, content that promotes violence, terrorism or hatred, or other illegal content;
- content that infringes someone else's intellectual property or privacy.

We screen prompts automatically and may block a request that breaks these rules; a blocked request costs no credits. We may remove content, suspend or close accounts, and report unlawful content to the authorities. The Acceptable Use Policy explains how we enforce it and how to report abuse.`,
        },
        api: {
          title: 'API access',
          body: `You can create API keys in your account to use the Service from your own software. A key is as sensitive as your password: store it safely, never put it in public code, and revoke it if it leaks. You are responsible for everything done with your keys, including the credits used.

API requests use the same credits, limits and rules as the web studio. We may limit request rates, and we may revoke keys that are abused or put the Service at risk. Do not resell access to the Service without our written permission.`,
        },
        thirdParties: {
          title: 'Third-party services',
          body: `The Service relies on other companies: AI model providers, such as fal.ai, generate content, and Moyasar processes payments. Their own terms and privacy notices apply to the parts of the Service they provide, and a model provider's terms can restrict how some outputs may be used {confirm}. We are not responsible for services we do not control, but we choose them with care.`,
        },
        ourRights: {
          title: 'Our rights',
          body: `The Service, its software, design, name and logo belong to us or our licensors. These terms give you a right to use the Service, not to own or copy any part of it. Do not copy, reverse engineer or attack the Service, or try to bypass its limits, credits, security or content checks.`,
        },
        termination: {
          title: 'Suspension and ending your account',
          body: `You can stop using the Service at any time and delete your account in your [account settings](/account). Deleting an account permanently removes your content, and any credits left are lost, so use them or ask for a refund under the [Refund Policy](/refunds) first.

We may suspend or close an account, with or without notice, if you break these terms or the Acceptable Use Policy, if the law requires it, or if your use puts the Service or other people at risk. If we close your account without a breach by you, we will refund the unused paid credits {confirm}. If you seriously breach these terms, the credits left in the account may be forfeited {confirm}.

If we decide to close the Service for good, we will give reasonable notice and refund unused paid credits {confirm}.

The parts of these terms that by their nature should continue, such as ownership, liability and dispute rules, stay in force after your account ends.`,
        },
        disclaimers: {
          title: 'Disclaimers',
          body: `The Service and all outputs are provided "as is" and "as available". To the extent the law allows, we give no warranty that the Service will meet your needs, be uninterrupted or error-free, or that outputs will be accurate, unique or suitable for a particular purpose {confirm}.

Nothing in these terms limits rights you have under mandatory consumer-protection law.`,
        },
        liability: {
          title: 'Limits on liability',
          body: `To the extent the law allows, we are not liable for indirect or consequential loss, for loss of profit, revenue, data or goodwill, or for loss caused by third-party services or by how you use outputs {confirm}.

To the extent the law allows, our total liability to you for all claims relating to the Service is limited to the amount you paid us in the 12 months before the event that gave rise to the claim {confirm}.

You agree to cover losses we suffer from claims by others that arise from your content or from your breach of these terms or the law, to the extent the law allows {confirm}.

Nothing in these terms excludes or limits liability that cannot be excluded or limited by law, such as liability for fraud or intentional misconduct.`,
        },
        law: {
          title: 'Governing law and disputes',
          body: `These terms are governed by the laws of the Kingdom of Saudi Arabia {confirm}. Please contact us first at {contactEmail} so that we can try to settle a dispute informally. If we cannot, the competent courts of the Kingdom of Saudi Arabia will decide it {confirm}, without prejudice to any mandatory rights you have as a consumer.`,
        },
        changes: {
          title: 'Changes to these terms',
          body: `We may update these terms, for example when the Service or the law changes. We will post the new version here with a new "last updated" date, and for important changes we will tell you by email or in the Service before they take effect {confirm}. If you keep using the Service after a change takes effect, you accept the new terms. If you do not agree, you can stop using the Service and delete your account.`,
        },
        general: {
          title: 'General',
          body: `These terms, together with the policies they refer to, are the whole agreement between you and us about the Service. If a part of them is found unenforceable, the rest still applies. If we do not enforce a right straight away, we have not given it up. You may not transfer your rights under these terms without our consent; we may transfer ours as part of a sale or reorganisation of our business.

These terms are published in Arabic and English. If the two differ, the Arabic version prevails {confirm}.

Questions about these terms: {contactEmail}.`,
        },
      },
    },
    privacy: {
      meta: {
        title: 'Privacy Policy',
        description:
          'What personal data AIVORE collects, why we use it, who we share it with, how long we keep it and the choices you have.',
      },
      title: 'Privacy Policy',
      summary:
        'What personal data we collect, why we use it, who we share it with, how long we keep it and the choices you have.',
      sections: {
        controller: {
          title: 'Who is responsible',
          body: `{companyName} ("we", "us") runs AIVORE and decides how your personal data is used. This policy describes our practices under the Saudi Personal Data Protection Law and, where they apply, similar laws such as the GDPR {confirm}.

- Company: {companyName}
- Commercial registration number: {companyCr}
- Address: {companyAddress}
- Privacy contact: {contactEmail}`,
        },
        data: {
          title: 'What we collect',
          body: `### Account details
Your email address, your name, your preferred language and a password. We never see or store your password itself, only a protected, salted hash of it.

### What you create
The prompts and settings you submit, the images you upload, and the images and videos generated for you, along with the status of each request.

### Credits, orders and plans
Your credit balance and its history (sign-up credits, purchases, usage, refunds), and your orders and subscription (what you bought, the amount, the status and the dates). When you pay, Moyasar tells us whether the payment went through; we never receive your card number.

### Technical and security data
The IP address and browser type (user agent) of your sign-ins, which we keep with your login sessions so that you can recognise them and so that we can protect accounts. The IP address you registered from, which we use to limit abuse of free credits. Short-lived counters that limit how fast requests can be made. Server logs of errors and security events; we do not write passwords, tokens or prompt text to logs in normal operation.

### API keys
The name you give each key, a short non-secret prefix and the time it was last used. We store only a one-way hash of the key itself.

### Messages
If you write to us, we keep your message and our reply. We also send you service emails, such as address confirmation, password reset and account notices.`,
        },
        use: {
          title: 'How we use your data, and why',
          body: `- To provide the Service: create your account, run your generations, keep your gallery and credits, process payments and send service emails. (Basis: our contract with you.)
- To keep the Service secure and fair: detect abuse, apply rate limits and the Acceptable Use Policy, screen prompts for prohibited content, review content that is reported, and protect accounts. (Basis: our legitimate interests.)
- To follow the law: keep accounting and tax records and answer lawful requests from authorities. (Basis: legal obligation.)
- To support and improve the Service: fix errors and answer your questions. (Basis: our legitimate interests.)

Where the law requires your consent, we ask for it, and you can withdraw it at any time. We do not sell your personal data, we do not use it for advertising, and we do not track you across other websites. We do not use your prompts, images or outputs to train our own AI models {confirm}.`,
        },
        cookies: {
          title: 'Cookies and local storage',
          body: `AIVORE uses only the cookies and similar storage that the Service needs to work. We use no advertising, analytics or tracking cookies, and no third-party cookies.

- [[aivore_session]] keeps you signed in. It is HttpOnly, so scripts on the page cannot read it. A session stays valid while you use the Service and ends after 30 days without use or when you log out, and at most 180 days after you signed in.
- [[aivore_locale]] remembers your language, for one year.
- [[aivore_theme]] remembers light, dark or system appearance, for one year.
- [[aivore_sidebar]] remembers whether the sidebar is collapsed, for one year.

Your browser's local storage also keeps your last-used studio settings on your own device; they are not sent to us.

Because these are strictly necessary, we do not show a cookie banner {confirm}. You can delete them in your browser settings, but you will be signed out and some preferences will be forgotten.`,
        },
        sharing: {
          title: 'Who we share data with',
          body: `We share personal data only with companies that help us run the Service, and only what they need:

- **fal.ai** generates images and videos. It receives your prompt, the generation settings and any image you submit, and returns the result.
- **Moyasar**, our payment provider, processes payments on its own payment page. It receives the order amount, a description and our order reference, while you give it your card and payment details directly. We never see your card number. Moyasar handles that data under its own privacy notice.
- **Our email provider** delivers service emails, such as address confirmation and password reset. It receives your email address and the content of the message.
- **Prompt screening and improvement services.** If we switch them on, text you enter may be sent to a third-party AI provider to check it against our content rules or to improve a prompt {confirm}.
- **Hosting and storage providers** keep the Service and its files running {confirm}.

We may also disclose data to authorities when the law requires it, to protect rights, safety or the Service, and to a buyer if our business is sold. We require the companies we work with to protect your data and to use it only for our purposes {confirm}.`,
        },
        publicContent: {
          title: 'Content you make public',
          body: `Your generations are private unless you choose to make them public. Anyone can see a public generation on the Explore page and through its share link, together with the name on your account. Other people or search engines may copy or index it, and we cannot take back copies that others have made. You can make it private again, or delete it, at any time; its public page then stops working.`,
        },
        transfers: {
          title: 'Transfers outside Saudi Arabia',
          body: `Some of the companies above, including the AI providers that generate your content, may process data outside the Kingdom of Saudi Arabia. When data leaves the Kingdom we do so as the Personal Data Protection Law allows, and we take steps to keep it protected {confirm}. Your data is stored on servers run by us or by our hosting providers, which may be inside or outside Saudi Arabia {confirm}.`,
        },
        retention: {
          title: 'How long we keep data',
          body: `- Account details and your content: until you delete them or your account. Deleting a generation removes its files from our storage.
- Login sessions: they end after 30 days without use, or when you log out, and expired ones are removed.
- Email confirmation and password reset links: a confirmation link expires after 24 hours and a reset link after 1 hour, and used or expired links are deleted after 7 days.
- Payment and accounting records, including your credit history: kept after you delete your account, without your name and email, for as long as tax and commercial law require {confirm}.
- A one-way code (a keyed hash) of your email address is kept after you delete your account, for one purpose only: so that deleting and registering again cannot be used to claim the free sign-up credits a second time.
- Backups and server logs: kept for a limited time and then overwritten or deleted {confirm}.

When we no longer need data, we delete it or make it anonymous.`,
        },
        rights: {
          title: 'Your rights',
          body: `Depending on the law that applies to you, you may have the right to:

- be told how your personal data is used (this policy);
- access your personal data and get a copy of it in a readable format;
- have inaccurate data corrected;
- have your personal data deleted or destroyed;
- withdraw consent you have given, without affecting what happened before;
- object to some uses of your data, or ask us to restrict them {confirm};
- complain to the competent data protection authority {confirm}.

You can do most of this yourself in your [account settings](/account): edit your name and language, download a copy of your data (a file with your profile, credit history, generations and links to your files), or delete your account. Deleting your account removes your content and personal details as described under "How long we keep data". For anything else, write to {contactEmail}. We may need to verify who you are, and we will answer within the time the law requires {confirm}.`,
        },
        security: {
          title: 'How we protect your data',
          body: `We use technical and organisational measures that fit the risk, including encrypted connections (HTTPS), salted password hashing, storing session tokens and API keys only in hashed form, HttpOnly cookies, protection against cross-site request forgery, rate limiting, and access controls on every file and record. No system is completely secure. If a breach affects your personal data, we will tell you and the authorities as the law requires {confirm}.`,
        },
        children: {
          title: 'Children',
          body: `The Service is not meant for people under 18, and we do not knowingly collect personal data from them {confirm}. If you believe a child has given us personal data, write to {contactEmail} and we will delete it.`,
        },
        changes: {
          title: 'Changes to this policy',
          body: `We may update this policy. The latest version is always on this page with its "last updated" date, and we will tell you about important changes by email or in the Service before they take effect {confirm}.`,
        },
        contact: {
          title: 'Contact us',
          body: `For questions or requests about your personal data, write to {contactEmail}, or to {companyName}, {companyAddress}.`,
        },
      },
    },
    refunds: {
      meta: {
        title: 'Refund Policy',
        description:
          'When credits are returned automatically, when you can ask for a refund, and how refunds and payment disputes work at AIVORE.',
      },
      title: 'Refund Policy',
      summary:
        'When credits come back automatically, when you can ask for your money back, and how refunds and payment disputes work.',
      sections: {
        overview: {
          title: 'In short',
          body: `- If a generation fails or you cancel it, the credits come back to your balance automatically.
- Credits never expire, so there is no rush to use them.
- You can ask for a refund of a purchase within {refundDays} days if its credits are unused {confirm}.
- Refunds go back to the card you paid with, through Moyasar.
- This policy does not limit rights you have under mandatory consumer law.`,
        },
        failed: {
          title: 'Failed and canceled generations',
          body: `You never pay for a generation that did not work. In these cases the credits are returned to your balance automatically, without any request from you:

- the generation fails for any reason, including a provider error, a timeout or a result we cannot deliver;
- you cancel it, or delete it, while it is still waiting or being processed;
- a request produces fewer results than you paid for: the credits for the missing results are returned;
- a request is rejected before it starts, for example because our content checks block it: nothing is charged.

You can see each refund in the credit history in your [account](/account). Credits are not returned for a generation that finished and delivered a result, even if you do not like how it looks, because AI output varies. If you believe a technical fault affected a result that was delivered, write to {supportEmail} and we will look into it.`,
        },
        packs: {
          title: 'Credit packs',
          body: `A credit pack is a one-time purchase of credits.

- Within {refundDays} days of buying a pack, you can ask for a refund of the credits you have not used {confirm}. If you have used some of the credits, we refund the price of the unused ones in proportion and take those credits back from your balance.
- After {refundDays} days, or for credits that have been used, a pack is not refundable, unless the law requires it or the cause was a fault on our side.
- The credits that belong to a refunded purchase are removed from your balance. We never take back more than your balance holds.`,
        },
        plans: {
          title: 'Monthly plans',
          body: `- You can cancel a plan at any time in your [account](/account). It then stops at the end of the month you have paid for, and we ask for no further payment. Cancelling does not refund the current month.
- If you pay for a month by mistake, or pay a renewal you did not mean to, write to us within {refundDays} days and, if you have not used its credits, we will refund it {confirm}.
- If we refund the payment for your current month, the plan ends at once and the credits that payment added are taken back, up to what is left in your balance. Credits from earlier months are not affected.
- If a plan lapses because a month was not paid, nothing is charged, and the credits you already received stay in your account.`,
        },
        free: {
          title: 'Free and bonus credits',
          body: `Credits we give you for free, such as sign-up credits or promotions, have no cash value and are not refundable.`,
        },
        request: {
          title: 'How to ask for a refund',
          body: `Write to {supportEmail} from the email address of your account and tell us which purchase it is about (its date and amount, or the order reference shown in your account). We may ask for more details. We will review your request and reply as soon as we can.`,
        },
        payout: {
          title: 'How refunds are paid',
          body: `We refund to the card or payment method you used, through Moyasar, in Saudi riyals and for the amount you paid, including VAT. How long it takes to appear depends on Moyasar and your bank, and it can take several business days. When a refund is approved, the related credits are removed from your balance as the refund is processed.`,
        },
        disputes: {
          title: 'Chargebacks and payment disputes',
          body: `Please contact us before you dispute a payment with your bank; we want to fix problems quickly. If a payment is reversed through a chargeback or a bank dispute, we take back the credits that payment added, up to your balance, and we may suspend the account until the matter is resolved {confirm}. Abusing chargebacks or refund requests may lead us to refuse future purchases.`,
        },
        law: {
          title: 'Your legal rights',
          body: `This policy sits alongside your rights under mandatory consumer-protection and e-commerce law, which it does not limit {confirm}. If the law gives you a longer or better right, the law applies.`,
        },
        contact: {
          title: 'Contact',
          body: `Questions about a refund: {supportEmail}. Company details are in the [Terms of Service](/terms).`,
        },
      },
    },
    acceptableUse: {
      meta: {
        title: 'Acceptable Use Policy',
        description:
          'The rules for what you may create, upload and share on AIVORE, how we enforce them and how to report abuse.',
      },
      title: 'Acceptable Use Policy',
      summary:
        'The rules for what you may create, upload and share on AIVORE, how we enforce them and how to report abuse.',
      sections: {
        scope: {
          title: 'Purpose and scope',
          body: `AIVORE lets people create images and video with AI. To keep it safe and lawful for everyone, this policy sets out what is not allowed. It applies to everything you do with the Service: the prompts you write, the images you upload, the results you generate, what you share publicly and your use of the API. It is part of our [Terms of Service](/terms).

The content rules apply however the content is made. Trying to get around them, for example by rewording a prompt after it was blocked, is also a breach of this policy.`,
        },
        prohibited: {
          title: 'Content that is never allowed',
          body: `You must not use the Service to create, upload, store or share:

- **Sexual content involving minors.** Any sexual or sexualised depiction of a person who is, or appears to be, under 18. We have zero tolerance: we remove it and report it to the authorities.
- **Non-consensual sexual content.** Nude or sexual images of real people made without their clear consent, including "undressing" or deepfake edits of someone's photo.
- **Impersonation and deception.** Realistic content that shows a real person saying or doing something they did not, or that pretends to come from a person or organisation, in order to deceive, defraud, defame or harass.
- **Violence, terrorism and hate.** Content that promotes, glorifies or helps carry out violence, terrorism or violent extremism, content that incites hatred or discrimination against people because of who they are, and content that encourages self-harm.
- **Illegal content.** Content that is unlawful where you live or in the Kingdom of Saudi Arabia, or that breaks public order or public morals {confirm}, including material that supports fraud, scams, human trafficking, or the making or sale of illegal drugs or weapons.
- **Infringement.** Content that infringes copyright, trademarks, privacy or other rights, including images you do not have the right to upload or edit.
- **Harassment and privacy abuse.** Content that targets, threatens, bullies or exposes a person, including publishing someone's private information or images.`,
        },
        misuse: {
          title: 'Misuse of the Service',
          body: `You must not:

- send spam, or use the Service or its outputs for scams, phishing or other abuse;
- abuse the API or the Service, for example by flooding it with requests, hiding your traffic, scraping it, or sharing, selling or leaking API keys;
- get around limits, credits, payment, security or content checks, or open several accounts to collect free credits;
- test the security of the Service or look for weaknesses without our written permission;
- resell access to the Service, or give it to others, without our permission;
- upload files that contain malware or are meant to harm the Service or its users.`,
        },
        uploads: {
          title: 'Images you upload',
          body: `Only upload images you have the right to use. Do not upload or edit photos of other people in a way they would not agree to, and never upload images of children for any sexual, harmful or misleading purpose. Our checks try to block requests that edit a photo of a real person to remove their clothing, and attempting it is a serious breach.`,
        },
        sharing: {
          title: 'Sharing and the Explore page',
          body: `What you make public is visible to everyone, so it must follow this policy. We may unpublish or remove public content at any time, without notice, if it breaks these rules or is reported. Do not present AI-generated content as real footage or photographs in order to mislead people, and follow any disclosure rules that apply where you publish it.`,
        },
        moderation: {
          title: 'How we moderate',
          body: `We check prompts automatically against built-in rules in Arabic and English, and we may also send text to a third-party moderation service. A prompt that breaks the rules is blocked before it runs and costs no credits. Automated checks are not perfect: they can miss things and sometimes block harmless prompts. When something is reported, or when we have reason to suspect a breach, our team may look at the related prompts, images and results, and limits that access to what is needed. Please do not probe the limits of our checks with repeated attempts.`,
        },
        enforcement: {
          title: 'What happens if you break the rules',
          body: `Depending on how serious the breach is and whether it is repeated, we may:

- block a request or remove content;
- warn you;
- limit features or suspend your account;
- close your account permanently, in which case unused credits may be forfeited {confirm};
- report the matter to the police or other authorities, and keep and share the data they lawfully ask for. We always report child sexual abuse material.

We may act without warning when a breach is serious, when the law requires it, or when we need to protect people or the Service.`,
        },
        report: {
          title: 'Report abuse',
          body: `If you see content or behaviour that breaks this policy, write to {contactEmail}. Tell us what you saw, where (the link to the page, or the generation) and when, so that we can find it. You may include your own contact details if you would like a reply. We review reports as quickly as we can and may remove content while we do.

If someone is in immediate danger, or you come across child sexual abuse material, please also contact your local authorities.`,
        },
        appeals: {
          title: 'If you think we got it wrong',
          body: `If we blocked a prompt, removed content or restricted your account and you believe this was a mistake, write to {supportEmail} with the details. A person will review it and we will tell you the outcome {confirm}.`,
        },
        changes: {
          title: 'Changes',
          body: `We may update this policy as new risks and laws appear. The current version is always on this page with its "last updated" date.`,
        },
      },
    },
  },
  ar: {
    common: {
      eyebrow: 'الوثائق القانونية',
      lastUpdated: 'آخر تحديث: {date}',
      tocLabel: 'في هذه الصفحة',
      related: 'وثائق قانونية أخرى',
      draft: {
        title: 'مسودة — بانتظار المراجعة القانونية',
        body: 'هذه الوثيقة نموذج لم يراجعه محامٍ بعد، وهي ليست استشارة قانونية وليست نهائية. العناصر المظلَّلة بين قوسين بيانات لا تزال على الشركة تزويدها، وعلامات «للتأكيد» تشير إلى صياغة تحتاج إلى قرار.',
      },
      placeholder: {
        missing: '[{label}: يُستكمل لاحقًا]',
        companyName: 'اسم الشركة',
        companyAddress: 'عنوان الشركة',
        companyCr: 'رقم السجل التجاري',
        vatNumber: 'الرقم الضريبي',
        contactEmail: 'البريد الإلكتروني للتواصل',
        supportEmail: 'بريد الدعم',
      },
      confirm: {
        short: 'للتأكيد',
        long: 'تحتاج هذه الصياغة إلى تأكيد من مستشار قانوني',
      },
    },
    nav: {
      terms: 'شروط الخدمة',
      privacy: 'سياسة الخصوصية',
      refunds: 'سياسة الاسترداد',
      acceptableUse: 'سياسة الاستخدام المقبول',
    },
    footer: {
      title: 'الشروط والسياسات',
    },
    consent: {
      line: 'بإنشاء حسابك، فإنك توافق على {terms} و{privacy}.',
      newTab: 'يُفتح في تبويب جديد',
    },
    terms: {
      meta: {
        title: 'شروط الخدمة',
        description:
          'الشروط التي تسري عند استخدامك AIVORE لتوليد الصور والفيديو وشراء الرصيد والاشتراك في الباقات.',
      },
      title: 'شروط الخدمة',
      summary:
        'توضّح هذه الشروط كيف يمكنك استخدام AIVORE، وكيف يعمل الرصيد والباقات، وما يحق لكلٍّ منا أن يتوقعه من الآخر. يُرجى قراءتها قبل إنشاء حسابك.',
      sections: {
        about: {
          title: 'من نحن وما هذه الشروط',
          body: `AIVORE خدمة إلكترونية لإنشاء الصور والفيديو من النصوص والصور، باللغتين العربية والإنجليزية («الخدمة»). تُشغّلها الشركة المبيّنة بياناتها أدناه («نحن»).

- الشركة: {companyName}
- رقم السجل التجاري: {companyCr}
- الرقم الضريبي: {vatNumber}
- العنوان: {companyAddress}
- البريد الإلكتروني للتواصل: {contactEmail}
- بريد الدعم: {supportEmail}

بإنشائك حسابًا أو باستخدامك الخدمة، فإنك توافق على شروط الخدمة هذه، وعلى [سياسة الخصوصية](/privacy) و[سياسة الاسترداد](/refunds) و[سياسة الاستخدام المقبول](/acceptable-use)، وهي جميعًا جزء لا يتجزأ منها. وإن لم توافق عليها فيُرجى عدم استخدام الخدمة.

وإذا كنت تستخدم الخدمة نيابةً عن منشأة أو جهة أخرى، فإنك تقرّ بأن لك صلاحية إلزامها بهذه الشروط.`,
        },
        account: {
          title: 'حسابك',
          body: `يجب ألا يقل عمرك عن ١٨ سنة، أو أن تكون متمتعًا بالأهلية القانونية للتعاقد في بلد إقامتك، حتى تنشئ حسابًا {confirm}.

قدّم لنا بيانات صحيحة وحافظ على تحديثها. وحافظ على سرّية كلمة المرور ومفاتيح الواجهة البرمجية (API)؛ فأنت مسؤول عمّا يجري عبر حسابك إلى أن تبلغنا بتعرّضه للاختراق. أبلغنا فورًا على {supportEmail} إن اشتبهت في أن شخصًا آخر يستطيع الدخول إلى حسابك.

أنشئ حسابًا واحدًا لنفسك. لا يجوز فتح عدة حسابات بغرض الحصول على رصيد التسجيل المجاني، ولا استخدام عناوين بريد مؤقتة لهذا الغرض، ويحق لنا رفض هذه الحسابات أو إغلاقها.

قد نطلب منك تأكيد بريدك الإلكتروني قبل أن تتمكن من توليد المحتوى. ويجوز لنا تعليق أي حساب نعتقد بوجه معقول أنه تعرّض للاختراق أو استُخدم على نحو يخالف هذه الشروط.`,
        },
        service: {
          title: 'الخدمة',
          body: `تحوّل الخدمة النصوص والصور التي تقدّمها إلى صور وفيديوهات جديدة باستخدام نماذج ذكاء اصطناعي، يُشغَّل بعضها بواسطة جهات خارجية. ويجوز لنا إضافة النماذج والأدوات والميزات والأسعار أو تعديلها أو إزالتها بحسب تطوّر التقنية وتكاليفنا.

نبذل جهدنا لإبقاء الخدمة متاحة، لكننا لا نضمن أن تعمل دون انقطاع أو دون أخطاء. فالتوليد يعتمد على جهات خارجية، وقد يفشل الطلب أو يستغرق وقتًا أطول من المتوقع. أما النماذج التجريبية (Demo)، متى وُجدت، فهي لتجربة الخدمة وتُنتج نتائج توضيحية فقط.

ويجوز لنا فرض حدود حفاظًا على العدالة والأمان، مثل عدد عمليات التوليد التي تعمل في وقت واحد، وأحجام الملفات، ومعدّلات الطلبات.`,
        },
        credits: {
          title: 'الرصيد',
          body: `يستهلك توليد المحتوى رصيدًا. وتظهر لك تكلفة الطلب في الاستوديو قبل إرساله، وتُخصم من رصيدك عند قبول الطلب.

- **لا تنتهي صلاحية الرصيد.** يبقى الرصيد غير المستخدم في حسابك ما دام الحساب قائمًا.
- ليس للرصيد قيمة نقدية، ولا يجوز تحويله أو بيعه أو إهداؤه أو استبداله بمال، باستثناء حالات الاسترداد المبيّنة في [سياسة الاسترداد](/refunds).
- إذا فشل التوليد، أو ألغيته قبل اكتماله، يُعاد الرصيد الذي استهلكه إلى حسابك تلقائيًا. وإذا أنتج الطلب نتائج أقل مما دفعت ثمنه، يُعاد رصيد النتائج الناقصة.
- الرصيد المجاني الذي نمنحه لك، كرصيد التسجيل مثلًا، هبة منا. ويجوز لنا تعديل هذه العروض أو إنهاؤها في أي وقت، ولا يمكن استرداده نقدًا.
- يظهر رصيدك وسجلّه (المشتريات والاستخدام وعمليات الاسترداد) في [حسابك](/account).

ويجوز لنا تصحيح أي رصيد يظهر خطأً بسبب عطل تقني، وخصم الرصيد الذي أُخذ بطريق إساءة الاستخدام أو الاحتيال.`,
        },
        plans: {
          title: 'حزم الرصيد والباقات والدفع',
          body: `يمكنك شراء الرصيد بطريقتين: حزم رصيد لمرة واحدة، وباقات شهرية تضيف عددًا محددًا من الرصيد عن كل شهر تدفع ثمنه. ويظهر لك الرصيد والسعر وما ستحصل عليه قبل الدفع.

### الأسعار والضرائب
الأسعار بالريال السعودي (SAR) وتشمل ضريبة القيمة المضافة بنسبة {vatPercent}٪. والسعر الظاهر عند بدء الدفع هو السعر الذي تدفعه. وإذا احتجت إلى فاتورة ضريبية لعملية شراء فراسلنا على {supportEmail} {confirm}.

### الدفع
تتولى معالجة المدفوعات شركة Moyasar، مزوّد خدمة الدفع لدينا، عبر صفحة الدفع الآمنة الخاصة بها. تُدخل بيانات بطاقتك هناك، ولا تصل إلينا ولا نحتفظ بها. ويُضاف الرصيد إلى حسابك بعد أن يؤكد مزوّد خدمة الدفع نجاح الدفع.

### الباقات الشهرية
- تمنحك الباقة عددًا ثابتًا من الرصيد عن كل شهر تدفع ثمنه. والرصيد الذي حصلت عليه سابقًا ملكك ويبقى في حسابك حتى لو توقفت عن الدفع لاحقًا.
- لا تسحب الباقة من بطاقتك تلقائيًا. فقبل نهاية الشهر المدفوع بنحو {leadDays} أيام نُصدر رابط دفع للشهر التالي، تجده في حسابك. وتتجدد الباقة ويُضاف رصيدها الشهري عندما تسدد قيمة هذا الرابط.
- إذا انتهى الشهر دون سداد، تصبح الباقة متأخرة السداد. ويمكنك السداد خلال {graceDays} أيام إضافية، وبعدها تنتهي الباقة ويتوقف الرابط عن العمل.
- يمكنك إلغاء الباقة في أي وقت من حسابك، فتتوقف عند نهاية الشهر الذي دفعت ثمنه، ولا نطلب منك أي دفعات أخرى. ولا يُسترد ثمن الشهر الحالي عند الإلغاء ما لم تنص [سياسة الاسترداد](/refunds) على خلاف ذلك.
- يمكنك الاشتراك في باقة واحدة نشطة في كل مرة.

### تغيير الأسعار
يجوز لنا تعديل الأسعار وكميات الرصيد والباقات. ويسري التعديل على عمليات الشراء التي تتم بعد نفاذه، وعلى التجديد التالي للباقة بعد إبلاغك به بالبريد الإلكتروني أو داخل الخدمة {confirm}. ويحق لك الإلغاء قبل سريان السعر الجديد عليك.`,
        },
        outputs: {
          title: 'المحتوى المولَّد بالذكاء الاصطناعي',
          body: `تنتج نماذج الذكاء الاصطناعي النتائج، ولا يمكن التنبؤ بها. ويُرجى مراعاة ما يلي:

- قد تكون النتائج غير دقيقة أو غير متوقعة أو متدنية الجودة أو مسيئة، وقد لا تطابق وصفك. وقد تشبه نتائج يحصل عليها آخرون أو أعمالًا موجودة، بل قد تتطابق معها.
- لا نفحص النتائج من حيث الدقة أو الأصالة أو سلامتها القانونية. وأنت المسؤول عن مراجعتها قبل استخدامها أو نشرها.
- قد لا تتمتع المحتويات المولَّدة بالذكاء الاصطناعي بحماية حقوق المؤلف أو ما يشبهها من الحقوق في بعض الدول.
- لا تعتمد على الخدمة في الحصول على استشارات مهنية أو طبية أو قانونية أو مالية، ولا في القرارات التي تمس سلامة الناس أو حقوقهم.

### ملكية النتائج
فيما بينك وبيننا، وبالقدر الذي يسمح به القانون، تكون النتائج التي تولّدها ملكًا لك ولا ندّعي ملكيتها. ويخضع ذلك لهذه الشروط ولحقوق الآخرين ولشروط مزوّدي النماذج الخارجيين الذين تنتج نماذجهم المحتوى {confirm}. ولا نضمن خلوّ أي نتيجة من حقوق الغير.

### مسؤوليتك
أنت المسؤول عن النصوص والصور التي تقدّمها وعن طريقة استخدامك النتائج ومشاركتها. ويجب أن يكون لك حق استخدام الصور التي ترفعها، وأن تلتزم [سياسة الاستخدام المقبول](/acceptable-use). وعند نشر أي نتيجة تكون مسؤولًا عن الإفصاح الذي يوجبه القانون أو المنصة التي تنشر عليها، كالإفصاح عن أنها أُنشئت بالذكاء الاصطناعي.`,
        },
        yourContent: {
          title: 'محتواك والمشاركة',
          body: `«محتواك» يعني النصوص والإعدادات والصور التي تقدّمها والنتائج التي تولّدها. وتبقى حقوقك فيه محفوظة لك.

تمنحنا ترخيصًا محدودًا وغير حصري وعالميًا لتخزين محتواك ومعالجته ونقله وعرضه، ولتمريره إلى مزوّدي الخدمة لدينا، وذلك بالقدر اللازم فقط لتشغيل الخدمة لأجلك وللحفاظ على أمانها وللامتثال للقانون. وينتهي هذا الترخيص بحذف محتواك، عدا النسخ التي تبقى في النسخ الاحتياطية مدة محدودة {confirm} أو التي يلزمنا القانون بالاحتفاظ بها.

تبقى عمليات التوليد التي تجريها خاصة بك بشكل افتراضي. وإذا اخترت جعل إحداها عامة، فيمكن لأي شخص رؤيتها في صفحة «استكشاف» وعبر رابط المشاركة الخاص بها، مع الاسم الظاهر في حسابك. ويمكنك إعادتها خاصة أو حذفها في أي وقت؛ أما النسخ التي حفظها آخرون فهي خارج سيطرتنا.

لا نستخدم نصوصك ولا صورك ولا نتائجك لتدريب نماذج الذكاء الاصطناعي الخاصة بنا {confirm}. ويعالج مزوّدو التوليد لدينا محتواك وفق شروطهم الخاصة؛ راجع [سياسة الخصوصية](/privacy).`,
        },
        acceptableUse: {
          title: 'الاستخدام المقبول',
          body: `يجب أن تستخدم الخدمة بما يتوافق مع القانون وأن تلتزم [سياسة الاستخدام المقبول](/acceptable-use). ويُحظر عليك خصوصًا إنشاء المحتوى التالي أو رفعه أو مشاركته:

- محتوى جنسي يتعلق بالقاصرين، أو صور عارية أو جنسية لأشخاص حقيقيين دون موافقتهم؛
- محتوى ينتحل شخصية شخص حقيقي أو يخدع الآخرين، أو يروّج للعنف أو الإرهاب أو الكراهية، أو أي محتوى آخر مخالف للقانون؛
- محتوى ينتهك الملكية الفكرية للغير أو خصوصيته.

نفحص الطلبات النصية آليًا، ويجوز لنا حظر أي طلب يخالف هذه القواعد، ولا يُخصم أي رصيد عن الطلب المحظور. ويجوز لنا إزالة المحتوى وتعليق الحسابات أو إغلاقها، وإبلاغ الجهات المختصة بالمحتوى المخالف للقانون. وتوضح سياسة الاستخدام المقبول كيف نطبّقها وكيف تبلّغ عن إساءة الاستخدام.`,
        },
        api: {
          title: 'الوصول عبر الواجهة البرمجية',
          body: `يمكنك إنشاء مفاتيح واجهة برمجية (API) في حسابك لاستخدام الخدمة من برمجياتك الخاصة. والمفتاح بحساسية كلمة المرور: احفظه في مكان آمن، ولا تضعه في شيفرة عامة، وألغِه إذا تسرّب. وأنت مسؤول عن كل ما يُنفَّذ بمفاتيحك، بما في ذلك الرصيد المستهلك.

تخضع طلبات الواجهة البرمجية للرصيد والحدود والقواعد نفسها المطبّقة على الاستوديو. ويجوز لنا تحديد معدّلات الطلبات، وإلغاء المفاتيح التي يُساء استخدامها أو تعرّض الخدمة للخطر. ولا يجوز لك إعادة بيع الوصول إلى الخدمة دون إذن كتابي منا.`,
        },
        thirdParties: {
          title: 'خدمات الأطراف الخارجية',
          body: `تعتمد الخدمة على شركات أخرى: فمزوّدو نماذج الذكاء الاصطناعي، مثل fal.ai، يولّدون المحتوى، وتتولى Moyasar معالجة المدفوعات. وتسري شروط هذه الجهات وإشعارات خصوصيتها على الأجزاء التي تقدّمها من الخدمة، وقد تقيّد شروط مزوّد النموذج طريقة استخدام بعض النتائج {confirm}. ولا نتحمل المسؤولية عن خدمات لا نتحكم بها، لكننا نختارها بعناية.`,
        },
        ourRights: {
          title: 'حقوقنا',
          body: `الخدمة وبرمجياتها وتصميمها واسمها وشعارها مملوكة لنا أو لمرخِّصينا. وتمنحك هذه الشروط حق استخدام الخدمة، لا حق تملّك أي جزء منها أو نسخه. ولا يجوز لك نسخ الخدمة أو هندستها عكسيًا أو مهاجمتها، أو محاولة تجاوز حدودها أو رصيدها أو أمنها أو فحوصات المحتوى فيها.`,
        },
        termination: {
          title: 'تعليق الحساب وإنهاؤه',
          body: `يمكنك التوقف عن استخدام الخدمة في أي وقت وحذف حسابك من [إعدادات حسابك](/account). ويؤدي حذف الحساب إلى إزالة محتواك نهائيًا وفقدان ما تبقى من الرصيد، فاستخدم رصيدك أو اطلب استرداده وفق [سياسة الاسترداد](/refunds) قبل ذلك.

يجوز لنا تعليق أي حساب أو إغلاقه، بإشعار أو دونه، إذا خالفت هذه الشروط أو سياسة الاستخدام المقبول، أو إذا أوجب القانون ذلك، أو إذا عرّض استخدامك الخدمة أو الآخرين للخطر. وإذا أغلقنا حسابك دون مخالفة منك فسنردّ ثمن الرصيد المدفوع غير المستخدم {confirm}. أما إذا ارتكبت مخالفة جسيمة لهذه الشروط فقد يسقط ما تبقى في حسابك من رصيد {confirm}.

وإذا قررنا إيقاف الخدمة نهائيًا فسنمنحك إشعارًا مسبقًا معقولًا ونردّ ثمن الرصيد المدفوع غير المستخدم {confirm}.

وتظل الأحكام التي تقتضي طبيعتها استمرارها، كأحكام الملكية والمسؤولية وتسوية المنازعات، سارية بعد انتهاء حسابك.`,
        },
        disclaimers: {
          title: 'إخلاء المسؤولية عن الضمانات',
          body: `تُقدَّم الخدمة وجميع النتائج «كما هي» و«حسب توفرها». وبالقدر الذي يجيزه القانون، لا نقدّم أي ضمان بأن تلبي الخدمة احتياجاتك أو أن تعمل دون انقطاع أو دون أخطاء، أو بأن تكون النتائج دقيقة أو فريدة أو صالحة لغرض معيّن {confirm}.

ولا يوجد في هذه الشروط ما يحدّ من حقوقك بموجب أنظمة حماية المستهلك الإلزامية.`,
        },
        liability: {
          title: 'حدود المسؤولية',
          body: `بالقدر الذي يجيزه القانون، لا نتحمل المسؤولية عن الخسائر غير المباشرة أو التبعية، ولا عن فوات الربح أو الإيراد أو البيانات أو السمعة التجارية، ولا عن الخسائر الناجمة عن خدمات الأطراف الخارجية أو عن طريقة استخدامك للنتائج {confirm}.

وبالقدر الذي يجيزه القانون، يقتصر إجمالي مسؤوليتنا تجاهك عن جميع المطالبات المتعلقة بالخدمة على المبلغ الذي دفعته لنا خلال الأشهر الـ١٢ السابقة للواقعة التي نشأت عنها المطالبة {confirm}.

وتوافق على تعويضنا عن الخسائر التي نتكبدها بسبب مطالبات الغير الناشئة عن محتواك أو عن مخالفتك لهذه الشروط أو للقانون، بالقدر الذي يجيزه القانون {confirm}.

ولا يستثني أي حكم في هذه الشروط المسؤولية التي لا يجوز استثناؤها أو تقييدها قانونًا، كالمسؤولية عن الغش أو الخطأ العمد.`,
        },
        law: {
          title: 'القانون الواجب التطبيق وتسوية المنازعات',
          body: `تخضع هذه الشروط لأنظمة المملكة العربية السعودية وتُفسَّر وفقًا لها {confirm}. ويُرجى التواصل معنا أولًا على {contactEmail} لمحاولة تسوية أي خلاف وديًا. فإن تعذّر ذلك، فتختص بالنظر فيه المحاكم المختصة في المملكة العربية السعودية {confirm}، دون إخلال بما تتمتع به من حقوق إلزامية بصفتك مستهلكًا.`,
        },
        changes: {
          title: 'تعديل هذه الشروط',
          body: `يجوز لنا تحديث هذه الشروط، كأن تتغير الخدمة أو القانون. وسننشر النسخة الجديدة في هذه الصفحة مع تاريخ «آخر تحديث» جديد، وفي التعديلات الجوهرية سنبلغك بالبريد الإلكتروني أو داخل الخدمة قبل سريانها {confirm}. ويُعدّ استمرارك في استخدام الخدمة بعد سريان التعديل قبولًا منك للشروط الجديدة. وإن لم توافق عليها فيمكنك التوقف عن استخدام الخدمة وحذف حسابك.`,
        },
        general: {
          title: 'أحكام عامة',
          body: `تمثّل هذه الشروط، مع السياسات التي تحيل إليها، الاتفاق الكامل بينك وبيننا بشأن الخدمة. وإذا تبيّن أن جزءًا منها غير قابل للتنفيذ فيظل الباقي ساريًا. وعدم تمسكنا بحق ما فور نشوئه لا يعني تنازلنا عنه. ولا يجوز لك التنازل عن حقوقك بموجب هذه الشروط دون موافقتنا، ويجوز لنا التنازل عن حقوقنا ضمن بيع أعمالنا أو إعادة هيكلتها.

تُنشر هذه الشروط باللغتين العربية والإنجليزية. وعند الاختلاف بينهما تُعتمد النسخة العربية {confirm}.

للاستفسار عن هذه الشروط: {contactEmail}.`,
        },
      },
    },
    privacy: {
      meta: {
        title: 'سياسة الخصوصية',
        description:
          'ما البيانات الشخصية التي يجمعها AIVORE، ولماذا نستخدمها، ومع من نشاركها، ومدة الاحتفاظ بها، والخيارات المتاحة لك.',
      },
      title: 'سياسة الخصوصية',
      summary:
        'ما البيانات الشخصية التي نجمعها، ولماذا نستخدمها، ومع من نشاركها، ومدة الاحتفاظ بها، والخيارات المتاحة لك.',
      sections: {
        controller: {
          title: 'الجهة المسؤولة',
          body: `تُشغّل شركة {companyName} («نحن») خدمة AIVORE وتحدد كيفية استخدام بياناتك الشخصية. وتبيّن هذه السياسة ممارساتنا وفق نظام حماية البيانات الشخصية في المملكة العربية السعودية، ووفق القوانين المماثلة، مثل اللائحة العامة لحماية البيانات (GDPR)، حيثما تسري {confirm}.

- الشركة: {companyName}
- رقم السجل التجاري: {companyCr}
- العنوان: {companyAddress}
- جهة الاتصال بشأن الخصوصية: {contactEmail}`,
        },
        data: {
          title: 'ما الذي نجمعه',
          body: `### بيانات الحساب
بريدك الإلكتروني واسمك ولغتك المفضلة وكلمة المرور. ولا نطّلع على كلمة مرورك نفسها ولا نخزّنها، بل نحتفظ فقط بقيمة تجزئة محمية ومُضاف إليها قيمة عشوائية (Salt).

### ما تنشئه
النصوص والإعدادات التي تقدّمها، والصور التي ترفعها، والصور والفيديوهات التي تُولَّد لك، مع حالة كل طلب.

### الرصيد والطلبات والباقات
رصيدك وسجلّه (رصيد التسجيل والمشتريات والاستخدام وعمليات الاسترداد)، وطلباتك واشتراكك (ما اشتريته ومبلغه وحالته وتواريخه). وعند الدفع تخبرنا Moyasar بنجاح الدفع من عدمه، ولا يصلنا رقم بطاقتك أبدًا.

### بيانات تقنية وأمنية
عنوان IP ونوع المتصفح (User Agent) عند تسجيل دخولك، ونحتفظ بهما مع جلسات الدخول لتتعرّف عليها ولنحمي الحسابات. وعنوان IP الذي سجّلت منه، ونستخدمه للحد من إساءة استخدام الرصيد المجاني. وعدّادات قصيرة العمر تحدّ من سرعة إرسال الطلبات. وسجلّات الخادم للأخطاء والأحداث الأمنية؛ ولا نكتب كلمات المرور أو الرموز السرية أو نصوص الطلبات في السجلّات في التشغيل المعتاد.

### مفاتيح الواجهة البرمجية
الاسم الذي تمنحه لكل مفتاح، وبادئة قصيرة غير سرّية، ووقت آخر استخدام. ولا نخزّن من المفتاح نفسه إلا قيمة تجزئة أحادية الاتجاه.

### الرسائل
إذا راسلتنا فإننا نحتفظ برسالتك وبردّنا. كما نرسل إليك رسائل بريدية متعلقة بالخدمة، مثل تأكيد البريد وإعادة تعيين كلمة المرور وإشعارات الحساب.`,
        },
        use: {
          title: 'كيف نستخدم بياناتك ولماذا',
          body: `- لتقديم الخدمة: إنشاء حسابك وتنفيذ عمليات التوليد وحفظ معرضك ورصيدك ومعالجة المدفوعات وإرسال رسائل الخدمة. (الأساس: تنفيذ العقد المبرم معك.)
- للحفاظ على أمان الخدمة وعدالتها: كشف إساءة الاستخدام وتطبيق حدود معدّل الطلبات وسياسة الاستخدام المقبول، وفحص الطلبات النصية بحثًا عن المحتوى المحظور، ومراجعة المحتوى المُبلَّغ عنه، وحماية الحسابات. (الأساس: مصالحنا المشروعة.)
- للامتثال للقانون: الاحتفاظ بالسجلات المحاسبية والضريبية والرد على الطلبات النظامية للجهات المختصة. (الأساس: التزام قانوني.)
- لدعم الخدمة وتحسينها: إصلاح الأخطاء والرد على استفساراتك. (الأساس: مصالحنا المشروعة.)

وحيثما يشترط القانون الحصول على موافقتك فإننا نطلبها، ويمكنك سحبها في أي وقت. ولا نبيع بياناتك الشخصية، ولا نستخدمها في الإعلانات، ولا نتتبعك عبر المواقع الأخرى. ولا نستخدم نصوصك ولا صورك ولا نتائجك لتدريب نماذج الذكاء الاصطناعي الخاصة بنا {confirm}.`,
        },
        cookies: {
          title: 'ملفات تعريف الارتباط والتخزين المحلي',
          body: `يستخدم AIVORE ملفات تعريف الارتباط وما يشبهها من وسائل التخزين التي تحتاج إليها الخدمة لتعمل فقط. ولا نستخدم ملفات تعريف ارتباط للإعلانات أو التحليلات أو التتبّع، ولا ملفات تعريف ارتباط تابعة لأطراف خارجية.

- [[aivore_session]] يُبقيك مسجّل الدخول. وهو محمي (HttpOnly) فلا تستطيع النصوص البرمجية في الصفحة قراءته. وتبقى الجلسة صالحة ما دمت تستخدم الخدمة، وتنتهي بعد ٣٠ يومًا دون استخدام أو عند تسجيل الخروج، وبحد أقصى ١٨٠ يومًا من تسجيل الدخول.
- [[aivore_locale]] يحفظ لغتك المفضلة لمدة سنة.
- [[aivore_theme]] يحفظ المظهر (فاتح أو داكن أو حسب النظام) لمدة سنة.
- [[aivore_sidebar]] يحفظ حالة القائمة الجانبية (مطويّة أو موسّعة) لمدة سنة.

ويحفظ التخزين المحلي في متصفحك أيضًا آخر إعدادات استخدمتها في الاستوديو على جهازك أنت، ولا تُرسل إلينا.

ولأن هذه الملفات ضرورية تمامًا، فلا نعرض شريط موافقة على ملفات تعريف الارتباط {confirm}. ويمكنك حذفها من إعدادات متصفحك، لكنك ستخرج من حسابك وستُنسى بعض تفضيلاتك.`,
        },
        sharing: {
          title: 'مع من نشارك البيانات',
          body: `لا نشارك البيانات الشخصية إلا مع شركات تساعدنا في تشغيل الخدمة، ولا نشارك إلا ما تحتاج إليه:

- **fal.ai** تولّد الصور والفيديوهات. وتتلقى نصّك وإعدادات التوليد وأي صورة تقدّمها، وتعيد إلينا النتيجة.
- **Moyasar**، مزوّد خدمة الدفع لدينا، تعالج المدفوعات عبر صفحة الدفع الخاصة بها. وتتلقى مبلغ الطلب ووصفه ورقمنا المرجعي للطلب، بينما تقدّم لها بيانات بطاقتك وبيانات الدفع مباشرةً. ولا يصلنا رقم بطاقتك أبدًا. وتعالج Moyasar هذه البيانات وفق إشعار الخصوصية الخاص بها.
- **مزوّد البريد الإلكتروني لدينا** يوصل رسائل الخدمة، مثل تأكيد البريد وإعادة تعيين كلمة المرور. ويتلقى عنوان بريدك ومحتوى الرسالة.
- **خدمات فحص الطلبات وتحسينها.** إذا فعّلناها فقد يُرسل النص الذي تكتبه إلى مزوّد ذكاء اصطناعي خارجي لفحصه وفق قواعد المحتوى لدينا أو لتحسين الوصف {confirm}.
- **مزوّدو الاستضافة والتخزين** يُبقون الخدمة وملفاتها قيد التشغيل {confirm}.

وقد نفصح عن البيانات للجهات المختصة حين يقتضي القانون ذلك، أو لحماية الحقوق أو السلامة أو الخدمة، وإلى مشترٍ إذا بيعت أعمالنا. ونلزم الشركات التي نتعامل معها بحماية بياناتك وباستخدامها لأغراضنا فقط {confirm}.`,
        },
        publicContent: {
          title: 'المحتوى الذي تجعله عامًا',
          body: `تبقى عمليات التوليد التي تجريها خاصة بك ما لم تختر جعلها عامة. ويمكن لأي شخص رؤية العملية العامة في صفحة «استكشاف» وعبر رابط مشاركتها، مع الاسم الظاهر في حسابك. وقد ينسخها آخرون أو تفهرسها محركات البحث، ولا نستطيع استرجاع النسخ التي أخذها الآخرون. ويمكنك إعادتها خاصة أو حذفها في أي وقت، وعندها تتوقف صفحتها العامة عن العمل.`,
        },
        transfers: {
          title: 'نقل البيانات خارج المملكة',
          body: `قد تعالج بعض الشركات المذكورة أعلاه البيانات خارج المملكة العربية السعودية، ومنها مزوّدو الذكاء الاصطناعي الذين يولّدون محتواك. وحين تنتقل البيانات خارج المملكة فإننا نفعل ذلك بالقدر الذي يجيزه نظام حماية البيانات الشخصية، ونتخذ خطوات لإبقائها محمية {confirm}. وتُخزَّن بياناتك على خوادم نشغّلها نحن أو مزوّدو الاستضافة لدينا، وقد تكون داخل المملكة أو خارجها {confirm}.`,
        },
        retention: {
          title: 'مدة الاحتفاظ بالبيانات',
          body: `- بيانات الحساب ومحتواك: حتى تحذفها أو تحذف حسابك. ويؤدي حذف أي عملية توليد إلى إزالة ملفاتها من مساحة التخزين لدينا.
- جلسات الدخول: تنتهي بعد ٣٠ يومًا دون استخدام أو عند تسجيل الخروج، وتُزال المنتهية منها.
- روابط تأكيد البريد وإعادة تعيين كلمة المرور: تنتهي صلاحية رابط التأكيد بعد ٢٤ ساعة ورابط إعادة التعيين بعد ساعة واحدة، وتُحذف الروابط المستخدمة أو المنتهية بعد ٧ أيام.
- سجلات الدفع والمحاسبة، ومنها سجلّ رصيدك: تبقى بعد حذف حسابك بعد تجريدها من اسمك وبريدك، للمدة التي تتطلبها الأنظمة الضريبية والتجارية {confirm}.
- يبقى رمز أحادي الاتجاه (قيمة تجزئة مفتاحية) لبريدك بعد حذف حسابك، لغرض واحد هو منع استغلال الحذف وإعادة التسجيل للحصول على رصيد التسجيل المجاني مرة ثانية.
- النسخ الاحتياطية وسجلات الخادم: تُحفظ مدة محدودة ثم يُكتب فوقها أو تُحذف {confirm}.

وحين لا نعود بحاجة إلى البيانات نحذفها أو نجعلها مجهولة الهوية.`,
        },
        rights: {
          title: 'حقوقك',
          body: `بحسب القانون الذي يسري عليك، قد يكون لك الحق في:

- معرفة كيفية استخدام بياناتك الشخصية (وهذا ما توضحه هذه السياسة)؛
- الاطلاع على بياناتك الشخصية والحصول على نسخة منها بصيغة مقروءة؛
- تصحيح البيانات غير الدقيقة؛
- حذف بياناتك الشخصية أو إتلافها؛
- سحب الموافقة التي منحتها، دون المساس بما تم قبل سحبها؛
- الاعتراض على بعض استخدامات بياناتك أو طلب تقييدها {confirm}؛
- تقديم شكوى إلى الجهة المختصة بحماية البيانات {confirm}.

يمكنك ممارسة معظم هذه الحقوق بنفسك من [إعدادات حسابك](/account): عدّل اسمك ولغتك، أو نزّل نسخة من بياناتك (ملف يضم ملفك الشخصي وسجلّ رصيدك وعمليات التوليد وروابط ملفاتك)، أو احذف حسابك. ويؤدي حذف الحساب إلى إزالة محتواك وبياناتك الشخصية على النحو المبيّن في «مدة الاحتفاظ بالبيانات». ولأي طلب آخر راسلنا على {contactEmail}. وقد نحتاج إلى التحقق من هويتك، وسنرد خلال المدة التي يحددها القانون {confirm}.`,
        },
        security: {
          title: 'كيف نحمي بياناتك',
          body: `نطبّق تدابير تقنية وتنظيمية تتناسب مع المخاطر، منها الاتصالات المشفّرة (HTTPS)، وتجزئة كلمات المرور مع إضافة قيمة عشوائية، وتخزين رموز الجلسات ومفاتيح الواجهة البرمجية بصيغة مجزَّأة فقط، وملفات تعريف الارتباط المحمية (HttpOnly)، والحماية من تزوير الطلبات عبر المواقع (CSRF)، وتحديد معدّلات الطلبات، وضوابط الوصول إلى كل ملف وسجل. ولا يوجد نظام آمن بالكامل. وإذا أثّر اختراق على بياناتك الشخصية فسنبلغك والجهات المختصة وفق ما يوجبه القانون {confirm}.`,
        },
        children: {
          title: 'الأطفال',
          body: `الخدمة غير موجهة لمن تقل أعمارهم عن ١٨ سنة، ولا نجمع عن قصد بيانات شخصية منهم {confirm}. وإذا اعتقدت أن طفلًا قدّم لنا بياناته الشخصية فراسلنا على {contactEmail} وسنحذفها.`,
        },
        changes: {
          title: 'تعديل هذه السياسة',
          body: `يجوز لنا تحديث هذه السياسة. وتجد أحدث نسخة دائمًا في هذه الصفحة مع تاريخ «آخر تحديث»، وسنبلغك بالتعديلات المهمة بالبريد الإلكتروني أو داخل الخدمة قبل سريانها {confirm}.`,
        },
        contact: {
          title: 'تواصل معنا',
          body: `لأي سؤال أو طلب يتعلق ببياناتك الشخصية، راسلنا على {contactEmail}، أو راسل {companyName}، {companyAddress}.`,
        },
      },
    },
    refunds: {
      meta: {
        title: 'سياسة الاسترداد',
        description:
          'متى يُعاد الرصيد تلقائيًا، ومتى يمكنك طلب استرداد المبلغ، وكيف تعمل عمليات الاسترداد والنزاعات على المدفوعات في AIVORE.',
      },
      title: 'سياسة الاسترداد',
      summary:
        'متى يعود الرصيد تلقائيًا، ومتى يمكنك طلب استرداد مالك، وكيف تتم عمليات الاسترداد والنزاعات على المدفوعات.',
      sections: {
        overview: {
          title: 'باختصار',
          body: `- إذا فشل التوليد أو ألغيته، يعود الرصيد إلى حسابك تلقائيًا.
- لا تنتهي صلاحية الرصيد، فلا داعي للاستعجال في استخدامه.
- يمكنك طلب استرداد ثمن عملية شراء خلال {refundDays} أيام إذا كان رصيدها غير مستخدم {confirm}.
- يُعاد المبلغ إلى البطاقة التي دفعت بها عبر Moyasar.
- لا تحدّ هذه السياسة من حقوقك بموجب أنظمة حماية المستهلك الإلزامية.`,
        },
        failed: {
          title: 'التوليد الفاشل والملغى',
          body: `لا تدفع أبدًا ثمن توليد لم ينجح. وفي الحالات التالية يُعاد الرصيد إلى حسابك تلقائيًا دون أي طلب منك:

- فشل التوليد لأي سبب، بما في ذلك خطأ لدى المزوّد أو انتهاء المهلة أو تعذّر تسليم النتيجة؛
- ألغيت التوليد أو حذفته وهو ما زال في الانتظار أو قيد المعالجة؛
- أنتج الطلب نتائج أقل مما دفعت ثمنه: يُعاد رصيد النتائج الناقصة؛
- رُفض الطلب قبل أن يبدأ، كأن تحظره فحوصات المحتوى لدينا: فلا يُخصم شيء.

وتجد كل عملية استرداد في سجلّ الرصيد داخل [حسابك](/account). ولا يُعاد الرصيد عن توليد اكتمل وسُلّمت نتيجته، حتى لو لم يعجبك شكلها، لأن مخرجات الذكاء الاصطناعي تتفاوت. وإذا اعتقدت أن عطلًا تقنيًا أثّر على نتيجة سُلّمت إليك، فراسلنا على {supportEmail} وسننظر في الأمر.`,
        },
        packs: {
          title: 'حزم الرصيد',
          body: `حزمة الرصيد عملية شراء رصيد لمرة واحدة.

- خلال {refundDays} أيام من شراء الحزمة، يمكنك طلب استرداد ثمن الرصيد غير المستخدم {confirm}. وإذا استخدمت جزءًا من الرصيد فنردّ ثمن الجزء غير المستخدم بالتناسب، ونخصم ذلك الرصيد من حسابك.
- بعد انقضاء {refundDays} أيام، أو عن الرصيد الذي استُخدم، لا تُسترد الحزمة ما لم يوجب القانون ذلك أو يكن السبب خطأً من جانبنا.
- يُخصم من رصيدك الرصيد المرتبط بعملية الشراء المستردة. ولا نخصم أبدًا أكثر مما يحتويه رصيدك.`,
        },
        plans: {
          title: 'الباقات الشهرية',
          body: `- يمكنك إلغاء الباقة في أي وقت من [حسابك](/account)، فتتوقف عند نهاية الشهر الذي دفعت ثمنه، ولا نطلب منك أي دفعات أخرى. ولا يُسترد ثمن الشهر الحالي عند الإلغاء.
- إذا دفعت ثمن شهر عن طريق الخطأ، أو دفعت تجديدًا لم تقصده، فراسلنا خلال {refundDays} أيام، وإن لم تكن قد استخدمت رصيده فسنردّ ثمنه {confirm}.
- إذا رددنا لك ثمن الشهر الحالي تنتهي الباقة فورًا، ويُخصم الرصيد الذي أضافته تلك الدفعة بحدود ما بقي في رصيدك. ولا يتأثر رصيد الأشهر السابقة.
- إذا انتهت باقتك لعدم سداد شهر، فلا يُخصم منك شيء، ويبقى في حسابك الرصيد الذي حصلت عليه.`,
        },
        free: {
          title: 'الرصيد المجاني والترويجي',
          body: `الرصيد الذي نمنحه لك مجانًا، كرصيد التسجيل أو العروض الترويجية، ليس له قيمة نقدية ولا يُسترد.`,
        },
        request: {
          title: 'كيف تطلب الاسترداد',
          body: `راسلنا على {supportEmail} من البريد الإلكتروني المسجّل في حسابك، وأخبرنا بعملية الشراء المقصودة (تاريخها ومبلغها، أو الرقم المرجعي للطلب الظاهر في حسابك). وقد نطلب منك تفاصيل إضافية. سنراجع طلبك ونرد عليك في أقرب وقت ممكن.`,
        },
        payout: {
          title: 'كيف يُدفع المبلغ المسترد',
          body: `نردّ المبلغ إلى البطاقة أو وسيلة الدفع التي استخدمتها، عبر Moyasar، بالريال السعودي وبالمبلغ الذي دفعته شاملًا ضريبة القيمة المضافة. ويعتمد وقت ظهوره على Moyasar وعلى مصرفك، وقد يستغرق عدة أيام عمل. وعند الموافقة على الاسترداد يُخصم الرصيد المرتبط به من حسابك عند تنفيذ عملية الاسترداد.`,
        },
        disputes: {
          title: 'الاعتراض على الدفع لدى المصرف',
          body: `يُرجى التواصل معنا قبل أن تعترض على أي دفعة لدى مصرفك، فنحن نحرص على حل المشكلات سريعًا. وإذا عُكست دفعة نتيجة اعتراض لدى المصرف (Chargeback) فإننا نخصم الرصيد الذي أضافته تلك الدفعة بحدود رصيدك، وقد نعلّق الحساب إلى حين حسم الأمر {confirm}. وقد تدفعنا إساءة استخدام الاعتراضات أو طلبات الاسترداد إلى رفض عمليات شراء مستقبلية.`,
        },
        law: {
          title: 'حقوقك القانونية',
          body: `تأتي هذه السياسة إلى جانب حقوقك بموجب أنظمة حماية المستهلك والتجارة الإلكترونية الإلزامية، ولا تحدّ منها {confirm}. وإذا منحك القانون حقًا أطول أو أفضل فإن القانون هو الذي يسري.`,
        },
        contact: {
          title: 'التواصل',
          body: `للاستفسار عن أي عملية استرداد: {supportEmail}. وبيانات الشركة موجودة في [شروط الخدمة](/terms).`,
        },
      },
    },
    acceptableUse: {
      meta: {
        title: 'سياسة الاستخدام المقبول',
        description:
          'القواعد المتعلقة بما يجوز لك إنشاؤه ورفعه ومشاركته على AIVORE، وكيف نطبّقها، وكيف تبلّغ عن إساءة الاستخدام.',
      },
      title: 'سياسة الاستخدام المقبول',
      summary:
        'القواعد المتعلقة بما يجوز لك إنشاؤه ورفعه ومشاركته على AIVORE، وكيف نطبّقها، وكيف تبلّغ عن إساءة الاستخدام.',
      sections: {
        scope: {
          title: 'الغرض والنطاق',
          body: `يتيح AIVORE للناس إنشاء الصور والفيديو بالذكاء الاصطناعي. ولكي تبقى الخدمة آمنة ومشروعة للجميع، تبيّن هذه السياسة ما هو غير مسموح به. وهي تسري على كل ما تفعله في الخدمة: النصوص التي تكتبها، والصور التي ترفعها، والنتائج التي تولّدها، وما تشاركه علنًا، واستخدامك للواجهة البرمجية. وهي جزء من [شروط الخدمة](/terms).

تسري قواعد المحتوى أيًّا كانت طريقة إنتاجه. ومحاولة التحايل عليها، كإعادة صياغة طلب بعد حظره، تُعدّ أيضًا مخالفة لهذه السياسة.`,
        },
        prohibited: {
          title: 'المحتوى المحظور دائمًا',
          body: `يُحظر عليك استخدام الخدمة لإنشاء المحتوى التالي أو رفعه أو تخزينه أو مشاركته:

- **المحتوى الجنسي المتعلق بالقاصرين.** أي تصوير جنسي أو مثير جنسيًا لشخص يقل عمره عن ١٨ سنة أو يبدو كذلك. ولا نتسامح في ذلك إطلاقًا، ونزيله ونبلّغ عنه الجهات المختصة.
- **المحتوى الجنسي دون موافقة.** صور عارية أو جنسية لأشخاص حقيقيين دون موافقتهم الصريحة، بما في ذلك «تعرية» صورة شخص ما أو تعديلها بتقنية التزييف العميق (Deepfake).
- **انتحال الشخصية والخداع.** محتوى واقعي يُظهر شخصًا حقيقيًا يقول أو يفعل ما لم يقله أو يفعله، أو يدّعي الصدور عن شخص أو جهة، بغرض الخداع أو الاحتيال أو التشهير أو المضايقة.
- **العنف والإرهاب والكراهية.** المحتوى الذي يروّج للعنف أو الإرهاب أو التطرف العنيف أو يمجّده أو يساعد على تنفيذه، والمحتوى الذي يحرّض على الكراهية أو التمييز ضد أشخاص بسبب هويتهم، والمحتوى الذي يشجع على إيذاء النفس.
- **المحتوى غير المشروع.** المحتوى المخالف للقانون في بلد إقامتك أو في المملكة العربية السعودية، أو المخل بالنظام العام أو الآداب العامة {confirm}، بما في ذلك ما يدعم الاحتيال أو الإتجار بالبشر أو صنع المخدرات والأسلحة غير المشروعة أو بيعها.
- **الانتهاك.** المحتوى الذي ينتهك حقوق المؤلف أو العلامات التجارية أو الخصوصية أو غيرها من الحقوق، بما في ذلك الصور التي ليس لك حق رفعها أو تعديلها.
- **المضايقة وانتهاك الخصوصية.** المحتوى الذي يستهدف شخصًا أو يهدده أو يتنمر عليه أو يفضحه، ومنه نشر معلومات شخص خاصة أو صوره.`,
        },
        misuse: {
          title: 'إساءة استخدام الخدمة',
          body: `يُحظر عليك:

- إرسال الرسائل المزعجة (السبام)، أو استخدام الخدمة أو نتائجها في عمليات احتيال أو تصيّد أو أي إساءة أخرى؛
- إساءة استخدام الواجهة البرمجية أو الخدمة، كإغراقها بالطلبات أو إخفاء مصدر حركتك أو سحب بياناتها آليًا أو مشاركة مفاتيح الواجهة أو بيعها أو تسريبها؛
- تجاوز الحدود أو الرصيد أو الدفع أو الأمان أو فحوصات المحتوى، أو فتح حسابات متعددة للحصول على رصيد مجاني؛
- اختبار أمن الخدمة أو البحث عن ثغراتها دون إذن كتابي منا؛
- إعادة بيع الوصول إلى الخدمة أو منحه للغير دون إذننا؛
- رفع ملفات تحتوي على برمجيات خبيثة أو تهدف إلى الإضرار بالخدمة أو بمستخدميها.`,
        },
        uploads: {
          title: 'الصور التي ترفعها',
          body: `لا ترفع إلا الصور التي يحق لك استخدامها. ولا ترفع صور الآخرين أو تعدّلها على نحو لا يوافقون عليه، ولا ترفع صور الأطفال لأي غرض جنسي أو ضار أو مضلل. وتحاول فحوصاتنا حظر الطلبات التي تعدّل صورة شخص حقيقي لإزالة ملابسه، ومحاولة ذلك مخالفة جسيمة.`,
        },
        sharing: {
          title: 'المشاركة وصفحة استكشاف',
          body: `ما تجعله عامًا يراه الجميع، ولذلك يجب أن يلتزم بهذه السياسة. ويجوز لنا إلغاء نشر المحتوى العام أو إزالته في أي وقت ودون إشعار إذا خالف هذه القواعد أو أُبلغ عنه. ولا تقدّم المحتوى المولَّد بالذكاء الاصطناعي على أنه لقطات أو صور حقيقية بقصد تضليل الناس، والتزم بأي قواعد إفصاح تسري في المكان الذي تنشر فيه.`,
        },
        moderation: {
          title: 'كيف نراقب المحتوى',
          body: `نفحص الطلبات النصية آليًا وفق قواعد مدمجة بالعربية والإنجليزية، وقد نرسل النص أيضًا إلى خدمة مراقبة محتوى تابعة لطرف خارجي. والطلب المخالف للقواعد يُحظر قبل تنفيذه ولا يُخصم عنه أي رصيد. والفحص الآلي غير مثالي: فقد يغفل أشياء، وقد يحظر أحيانًا طلبات بريئة. وعند ورود بلاغ، أو عند وجود سبب يدعو إلى الاشتباه في مخالفة، قد يطّلع فريقنا على النصوص والصور والنتائج ذات الصلة، ونقصر هذا الاطلاع على ما يلزم. ويُرجى عدم اختبار حدود فحوصاتنا بمحاولات متكررة.`,
        },
        enforcement: {
          title: 'ماذا يحدث إذا خالفت القواعد',
          body: `بحسب جسامة المخالفة وتكرارها، قد نتخذ أحد الإجراءات التالية أو أكثر:

- حظر طلب أو إزالة محتوى؛
- توجيه تنبيه إليك؛
- تقييد بعض الميزات أو تعليق حسابك؛
- إغلاق حسابك نهائيًا، وقد يسقط الرصيد غير المستخدم في هذه الحالة {confirm}؛
- إبلاغ الشرطة أو الجهات المختصة الأخرى، والاحتفاظ بالبيانات التي تطلبها نظامًا ومشاركتها معها. ونبلّغ دائمًا عن مواد الاعتداء الجنسي على الأطفال.

وقد نتصرف دون تنبيه مسبق إذا كانت المخالفة جسيمة، أو أوجب القانون ذلك، أو احتجنا إلى حماية الناس أو الخدمة.`,
        },
        report: {
          title: 'الإبلاغ عن إساءة الاستخدام',
          body: `إذا رأيت محتوى أو سلوكًا يخالف هذه السياسة فراسلنا على {contactEmail}. أخبرنا بما رأيته ومكانه (رابط الصفحة أو عملية التوليد) ووقته لنتمكن من الوصول إليه. ويمكنك إرفاق بيانات التواصل الخاصة بك إن رغبت في تلقي ردّ. ونراجع البلاغات بأسرع ما نستطيع، وقد نزيل المحتوى أثناء المراجعة.

وإذا كان أحدهم في خطر محدق، أو صادفت مواد اعتداء جنسي على الأطفال، فيُرجى الاتصال أيضًا بالجهات المختصة في بلدك.`,
        },
        appeals: {
          title: 'إذا رأيت أننا أخطأنا',
          body: `إذا حظرنا طلبًا أو أزلنا محتوى أو قيّدنا حسابك واعتقدت أن ذلك كان خطأً، فراسلنا على {supportEmail} وأرفق التفاصيل. وسيراجع الأمر شخص مختص، وسنبلغك بالنتيجة {confirm}.`,
        },
        changes: {
          title: 'التعديلات',
          body: `يجوز لنا تحديث هذه السياسة مع ظهور مخاطر وأنظمة جديدة. وتجد النسخة الحالية دائمًا في هذه الصفحة مع تاريخ «آخر تحديث».`,
        },
      },
    },
  },
});
