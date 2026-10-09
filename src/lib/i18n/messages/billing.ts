import { defineMessages } from '@/lib/i18n/define';

/**
 * Text of the shop: `/pricing`, the payment result page `/billing/return` and `/account/billing`.
 * Money amounts, dates and credit counts are never typed here: they are formatted with `Intl` and
 * arrive as `{placeholders}`. Statements about behaviour (what a renewal is, when a plan ends)
 * describe the billing module as built, see docs/ARCHITECTURE.md "Billing (as built)".
 */
export default defineMessages({
  en: {
    meta: {
      pricingTitle: 'Pricing',
      pricingDescription:
        'Buy credits once or subscribe for monthly credits. Prices in Saudi riyals, VAT included. Credits never expire.',
      returnTitle: 'Payment status',
      billingTitle: 'Billing & plans',
    },
    pricing: {
      hero: {
        eyebrow: 'Pricing',
        title: 'Pay only for what you create',
        subtitle:
          'Credits are one balance for every image and video. Buy a pack once, or subscribe for a fresh batch every month. Credits never expire.',
        bonus: 'New accounts start with {credits} on us.',
      },
      points: {
        never: 'Credits never expire',
        refund: 'Failed generations are refunded automatically',
        vat: 'Prices in Saudi riyals, VAT included',
      },
      mode: {
        label: 'What would you like to buy?',
        plans: 'Monthly plans',
        packs: 'One-time packs',
      },
      plans: {
        title: 'Monthly plans',
        description: 'A fresh batch of credits every month. Cancel any time.',
      },
      packs: {
        title: 'One-time credit packs',
        description: 'Pay once and use the credits whenever you like. No subscription.',
      },
      confirmEmail: {
        title: 'Confirm your email to buy credits',
        body: 'Purchases need a confirmed email address, so that receipts and renewal links reach you. We sent a link to {email}. Open it, then come back: this page updates by itself.',
        bonus: 'Confirming also adds your sign-up bonus of {credits}.',
      },
      hasPlan: {
        title: 'You already have a plan',
        body: 'A plan runs for the month you paid for. To switch to another one, cancel it in Billing and subscribe again once that month has ended. Packs are always available.',
        action: 'Manage plan',
      },
      loginHint: 'Already have an account?',
      loginLink: 'Log in',
      secure: 'Payment happens on a secure payment page. Card details never reach AIVORE.',
      calculator: {
        title: 'What can you make with your credits?',
        description:
          'Pick an amount to see what it buys at today’s prices, taken from the live model catalog.',
        amount: 'Credits',
        results: 'With {credits} you can make up to',
        each: '{credits} per generation',
        clip: '{credits} per {seconds} clip at {resolution}',
        images: {
          zero: 'No images',
          one: '1 image',
          two: '2 images',
          few: '{count} images',
          many: '{count} images',
          other: '{count} images',
        },
        videos: {
          zero: 'No clips',
          one: '1 clip',
          two: '2 clips',
          few: '{count} clips',
          many: '{count} clips',
          other: '{count} clips',
        },
        note: 'One generation with the default settings. Several images per request, longer clips and higher resolutions cost proportionally more; the studio always shows the exact cost before you generate.',
      },
      trust: {
        title: 'Buy with confidence',
        secure: {
          title: 'Secure payment',
          body: 'You pay on the payment provider’s own page. We never see or store your card details.',
        },
        vat: {
          title: 'Clear prices',
          body: 'Every price is in Saudi riyals and already includes VAT. No hidden fees.',
        },
        refund: {
          title: 'Fair refunds',
          body: 'Failed generations return their credits automatically. See the refund policy for purchases.',
        },
        keep: {
          title: 'Your credits stay yours',
          body: 'Credits never expire, and they stay in your balance even if you cancel a plan.',
        },
      },
      notice: {
        mockTitle: 'Test payments',
        mockBody:
          'This site uses a simulated payment page. No card is charged and no real money moves.',
        offTitle: 'Buying is paused',
        offBody: 'Buying credits is not available right now. Please come back a little later.',
      },
      faq: {
        title: 'Billing questions',
        items: {
          credits: {
            question: 'What is a credit, and do credits expire?',
            answer:
              'A credit is the unit your generations cost. A fast image can cost a single credit while a video clip costs more, and the studio shows the exact price before you generate. Credits never expire, whether they came from a pack, a plan or the welcome gift.',
          },
          choose: {
            question: 'Should I buy a pack or subscribe?',
            answer:
              'A pack is a single payment: ideal when you create now and then. A plan adds a fresh batch of credits every month, which suits regular work without buying again. Every card shows its price per 100 credits, so you can compare. You can mix both, and you can stop a plan at any time.',
          },
          vat: {
            question: 'Is VAT included in the price?',
            answer:
              'Yes. Every price on this page is in Saudi riyals and already includes {vat}% VAT. Each card shows how the price splits into the net amount and the VAT.',
          },
          renewal: {
            question: 'How does a plan renew? Is my card charged automatically?',
            answer:
              'No. We do not store your card and never charge it on our own. About {days} days before your month ends we email you a payment link for the next month, and it also waits on your Billing page. If the month ends unpaid we send a reminder. Pay the link and the next batch of credits arrives. If you do not pay within {grace} days after the month ends, the plan ends; credits you already received stay in your balance.',
          },
          cancel: {
            question: 'How do I cancel a plan?',
            answer:
              'Open Billing and choose Cancel plan. The plan stays active until the end of the month you paid for, no further payment is asked, and you can change your mind until then. Credits already in your balance are never taken back.',
          },
          failed: {
            question: 'What if a generation fails?',
            answer:
              'The credits come back to your balance automatically, with no request needed. Prompts that a content filter blocks are never charged.',
          },
          refunds: {
            question: 'Can I get a refund for a purchase?',
            answer:
              'Read the refund policy for what is refundable and how to ask. Credits that have already been spent on generations cannot be returned.',
          },
          payment: {
            question: 'How do I pay, and is it safe?',
            answer:
              'After you choose an item you are sent to the payment provider’s secure page, which offers the payment methods available for your card or wallet. Card details are entered there and never reach AIVORE. When you come back, this site confirms the payment with the provider before adding any credits.',
          },
        },
        refundLink: 'Refund policy',
      },
      legal: 'Prices include VAT.',
    },
    card: {
      popular: 'Most popular',
      current: 'Your plan',
      perMonth: '/ month',
      everyMonth: 'every month',
      oneTime: 'one time',
      per100: '{price} per 100 credits',
      vatIncluded: 'VAT included: {net} + {vat} VAT ({percent}%)',
      perks: {
        plan: {
          models: 'Every model in the studio and the API',
          never: 'Credits never expire, even after you cancel',
          cancel: 'Cancel any time; the plan ends with the month you paid for',
        },
        pack: {
          once: 'One payment, no subscription',
          never: 'Credits never expire',
          models: 'Every model in the studio and the API',
        },
      },
    },
    cta: {
      subscribe: 'Subscribe',
      buy: 'Buy now',
      signUpToSubscribe: 'Sign up to subscribe',
      signUpToBuy: 'Sign up to buy',
      opening: 'Opening payment page…',
      currentPlan: 'Your current plan',
      afterPlanEnds: 'Available after your plan ends',
      unavailable: 'Not available right now',
      confirmEmail: 'Confirm your email first',
    },
    confirm: {
      title: 'Subscribe to {plan}?',
      description: 'Please review how this plan works before you continue.',
      price: 'Price',
      priceValue: '{price} per month, VAT included',
      credits: 'Credits',
      creditsValue: '{credits} now, and again every month',
      renewal: 'Renewal',
      renewalValue:
        'About {days} days before your month ends we email you a payment link, and it also waits in Billing. We never charge your card automatically. If the month ends unpaid we send a reminder.',
      cancel: 'Cancellation',
      cancelValue:
        'Cancel any time in Billing. The plan then ends with the month you paid for, and your credits never expire.',
      secure: 'You will pay on the payment provider’s secure page.',
      mock: 'This is a test payment: no real money moves.',
      continue: 'Continue to payment',
      dismiss: 'Not now',
    },
    errors: {
      billingDisabled: 'Buying credits is not available right now. Please try again later.',
      subscriptionExists:
        'You already have a plan. Manage it in Billing; to switch, cancel it and subscribe again once the paid month has ended.',
      checkoutInProgress: 'Your payment page is still being prepared. Wait a moment and try again.',
      keyReused: 'That checkout was already used for a different item. Please try again.',
      checkoutClosed: 'The checkout was closed while it was being prepared. Please try again.',
      tooManyOpen:
        'You have several unpaid checkouts open. Pay for one of them in Billing, or wait until they expire (within a day), then try again.',
      gatewayDown:
        'The payment service is not responding right now. Nothing was charged. Please try again in a few minutes.',
      dailyLimit:
        'You have reached the limit of checkouts per 24 hours. Please try again in {wait}.',
      dailyLimitLater:
        'You have reached the limit of checkouts per 24 hours. Please try again later.',
      unauthorized: 'Your session has ended. Log in again to continue.',
      noPaymentPage:
        'The payment page could not be opened. Nothing was charged, so please try again.',
      subscriptionEnded: 'This plan has already ended. Subscribe again from the pricing page.',
      noSubscription: 'There is no plan on your account.',
      emailNotVerified:
        'Confirm your email address before you buy: until then your credits could not be used. We sent a confirmation link when you signed up, and you can request a new one from the banner at the top of your account pages.',
      openAccount: 'Open my account',
      logIn: 'Log in',
      openBilling: 'Open Billing',
    },
    return: {
      summary: {
        item: 'Item',
        amount: 'Amount (VAT included)',
        credits: 'Credits',
      },
      checking: {
        title: 'Checking your payment…',
        body: 'This usually takes a few seconds.',
      },
      pending: {
        title: 'Waiting for your payment',
        body: 'A payment can take a minute to confirm. You can safely leave this page: your credits are added as soon as the payment is confirmed, and this page keeps checking while it is open.',
        checkedAt: 'Last checked at {time}',
        long: 'This is taking longer than usual. There is nothing more you need to do: the credits are added automatically once the payment provider confirms the payment.',
        retrying: 'We could not reach the server just now and will keep trying.',
        checkNow: 'Check now',
        payPage: 'Go to the payment page',
      },
      expired: {
        title: 'This checkout expired',
        body: 'The payment page is no longer open. If you did not pay, start again. If you did pay, the credits are added automatically once the payment is confirmed.',
      },
      paid: {
        title: 'Payment received',
        pack: 'Thank you! {credits} were added to your balance.',
        plan: 'Thank you! Your {plan} plan is active and {credits} were added to your balance.',
        renewal: 'Thank you! Your {plan} plan continues and {credits} were added to your balance.',
        until: 'Your current month runs until {date}.',
        balance: 'New balance',
        balancePending: 'Updating your balance…',
        start: 'Start creating',
        billing: 'View billing',
      },
      failed: {
        title: 'Payment not completed',
        body: 'The payment did not go through, so no credits were added. If you were charged, the credits are added automatically once the payment is confirmed.',
        retry: 'Try again',
        billing: 'View billing',
      },
      canceled: {
        title: 'Checkout closed',
        body: 'This checkout was closed, so no credits were added. If you paid before it closed, the credits are added automatically once the payment is confirmed.',
      },
      refunded: {
        title: 'Payment refunded',
        body: 'This payment was refunded and the credits that came with it were taken back.',
      },
      review: {
        title: 'We are reviewing this payment',
        body: 'Something about this payment needs a manual check, so it is on hold. Nothing more is needed from you. See the refund policy for how to reach us if you need help.',
        contact: 'Refund policy',
      },
      notFound: {
        title: 'Order not found',
        body: 'We could not find this order on your account. Check the link, or open Billing to see your payments.',
      },
      missing: {
        title: 'No order to show',
        body: 'This page shows the result of a payment. Open Billing to see your payments, or pick something to buy.',
      },
      error: {
        title: 'We could not check your payment',
      },
      seePricing: 'See pricing',
      openBilling: 'Open Billing',
    },
    account: {
      title: 'Billing & plans',
      description: 'Your balance, your plan and your payments.',
      back: 'Account',
      balance: {
        title: 'Credit balance',
        note: 'Credits never expire.',
        buy: 'Buy credits',
      },
      plan: {
        title: 'Your plan',
        none: {
          title: 'No plan yet',
          body: 'Subscribe for a fresh batch of credits every month, or buy a one-time pack whenever you need more.',
          action: 'See plans and packs',
        },
        name: 'Plan',
        credits: 'Credits',
        creditsValue: '{credits} per month',
        price: 'Price',
        priceValue: '{price} per month, VAT included',
        renews: 'Renews on',
        ends: 'Ends on',
        endedOn: 'Ended on',
        periodEnded: 'This month ended on',
        next: 'Next payment',
        nextValue: '{price}, due by {date}',
        status: {
          active: 'Active',
          canceling: 'Canceling',
          past_due: 'Payment due',
          canceled: 'Canceled',
          expired: 'Expired',
          incomplete: 'Awaiting payment',
        },
        notes: {
          renewal:
            'Renewal is by payment link, not by charging your card. The link for next month appears here {days} days before this month ends, and we email it to you too.',
          canceling:
            'Your plan ends on {date}. Until then you keep using the credits you received, and credits in your balance never expire. You can undo the cancellation until then.',
          ended: 'This plan has ended. Credits already in your balance never expire.',
          incomplete: 'Finish the first payment to start this plan.',
        },
        renewalReady: {
          title: 'Your renewal payment is ready',
          body: 'Pay before {date} to keep your plan going. The credits arrive when the payment is confirmed.',
        },
        pastDue: {
          title: 'Your renewal payment is due',
          body: 'Pay before {date} to keep your plan. If you do not, the plan ends; credits you already received stay in your balance.',
          noLink:
            'The payment link is not available at the moment. Please check again in a little while.',
        },
        payNow: 'Pay now',
        completePayment: 'Complete payment',
        cancel: 'Cancel plan',
        resume: 'Resume plan',
        change: 'Change plan',
        again: 'Subscribe again',
        keep: 'Keep plan',
        cancelDialog: {
          title: 'Cancel your plan?',
          body: 'Your plan stays active until {date}, then ends. You will not be asked to pay again, and credits already in your balance never expire. You can undo this until {date}.',
          bodyNow:
            'Your payment is overdue, so the plan ends right away. Credits already in your balance never expire.',
          bodyUnpaid: 'The first payment has not been made. Canceling closes the payment page.',
          confirm: 'Cancel plan',
        },
        toast: {
          canceled: 'Your plan will end on {date}.',
          canceledNow: 'Your plan has been canceled.',
          resumed: 'Your plan will continue.',
        },
      },
      orders: {
        title: 'Payments',
        description: 'Everything you bought. Amounts include VAT.',
        columns: {
          date: 'Date',
          item: 'Item',
          amount: 'Amount',
          status: 'Status',
          credits: 'Credits',
          actions: 'Actions',
        },
        noCredits: 'No credits',
        kind: {
          pack: '{name}',
          subscription_initial: '{name} plan, first month',
          subscription_renewal: '{name} plan, renewal',
        },
        period: '{from} to {to}',
        refunded: 'Refunded {amount}',
        status: {
          pending: 'Awaiting payment',
          paid: 'Paid',
          failed: 'Failed',
          canceled: 'Canceled',
          refunded: 'Refunded',
          needs_review: 'Under review',
        },
        pay: 'Pay',
        view: 'Details',
        loadMore: 'Load more',
        loadingMore: 'Loading…',
        end: 'That is everything.',
        loadFailed: 'We could not load your payments.',
        empty: {
          title: 'No payments yet',
          body: 'When you buy credits or subscribe, your payments appear here.',
          action: 'See pricing',
        },
      },
      legal: {
        title: 'Legal',
        prices: 'Prices include VAT.',
      },
      loadFailed: 'We could not load your billing details.',
    },
  },
  ar: {
    meta: {
      pricingTitle: 'الأسعار',
      pricingDescription:
        'اشترِ رصيدًا لمرة واحدة أو اشترك للحصول على رصيد شهري. الأسعار بالريال السعودي شاملة ضريبة القيمة المضافة، والرصيد لا ينتهي.',
      returnTitle: 'حالة الدفع',
      billingTitle: 'الفوترة والباقات',
    },
    pricing: {
      hero: {
        eyebrow: 'الأسعار',
        title: 'ادفع فقط مقابل ما تصنعه',
        subtitle:
          'الرصيد محفظة واحدة لكل الصور والفيديوهات. اشترِ حزمة لمرة واحدة، أو اشترك لتحصل على رصيد جديد كل شهر. والرصيد لا ينتهي أبدًا.',
        bonus: 'يبدأ كل حساب جديد بـ {credits} هدية منا.',
      },
      points: {
        never: 'الرصيد لا ينتهي',
        refund: 'يُعاد الرصيد تلقائيًا عند فشل التوليد',
        vat: 'الأسعار بالريال السعودي شاملة الضريبة',
      },
      mode: {
        label: 'ماذا تود أن تشتري؟',
        plans: 'باقات شهرية',
        packs: 'حزم لمرة واحدة',
      },
      plans: {
        title: 'الباقات الشهرية',
        description: 'رصيد جديد كل شهر. يمكنك الإلغاء في أي وقت.',
      },
      packs: {
        title: 'حزم الرصيد لمرة واحدة',
        description: 'ادفع مرة واحدة واستخدم الرصيد متى شئت. بلا اشتراك.',
      },
      confirmEmail: {
        title: 'أكّد بريدك الإلكتروني لتشتري رصيدًا',
        body: 'تتطلب عمليات الشراء بريدًا إلكترونيًا مؤكّدًا حتى تصلك الإيصالات وروابط التجديد. أرسلنا رابطًا إلى {email}. افتحه ثم عُد إلى هنا: تتحدّث الصفحة تلقائيًا.',
        bonus: 'وسيضيف التأكيد أيضًا مكافأة التسجيل البالغة {credits}.',
      },
      hasPlan: {
        title: 'لديك باقة بالفعل',
        body: 'تعمل الباقة طوال الشهر الذي دفعته. للانتقال إلى باقة أخرى، ألغِ باقتك من صفحة الفوترة ثم اشترك من جديد بعد انتهاء ذلك الشهر. أما الحزم فمتاحة دائمًا.',
        action: 'إدارة الباقة',
      },
      loginHint: 'لديك حساب بالفعل؟',
      loginLink: 'سجّل الدخول',
      secure: 'تتم عملية الدفع في صفحة دفع آمنة، ولا تصل بيانات بطاقتك إلى AIVORE إطلاقًا.',
      calculator: {
        title: 'ماذا يمكنك أن تصنع برصيدك؟',
        description:
          'اختر مقدارًا لترى ما يكفيه بالأسعار الحالية المأخوذة من كتالوج النماذج الفعلي.',
        amount: 'الرصيد',
        results: 'بـ {credits} يمكنك صنع ما يصل إلى',
        each: '{credits} للعملية الواحدة',
        clip: '{credits} للمقطع مدته {seconds} بدقة {resolution}',
        images: {
          zero: 'لا صور',
          one: 'صورة واحدة',
          two: 'صورتان',
          few: '{count} صور',
          many: '{count} صورة',
          other: '{count} صورة',
        },
        videos: {
          zero: 'لا مقاطع',
          one: 'مقطع واحد',
          two: 'مقطعان',
          few: '{count} مقاطع',
          many: '{count} مقطعًا',
          other: '{count} مقطع',
        },
        note: 'عملية توليد واحدة بالإعدادات الافتراضية. تزيد التكلفة بنسبة عدد الصور في الطلب الواحد وطول المقطع ودقته، ويعرض لك الاستوديو التكلفة بالضبط قبل أن تبدأ.',
      },
      trust: {
        title: 'اشترِ بثقة',
        secure: {
          title: 'دفع آمن',
          body: 'تدفع في صفحة مزوّد الدفع نفسه، ولا نرى بيانات بطاقتك ولا نحفظها.',
        },
        vat: {
          title: 'أسعار واضحة',
          body: 'كل الأسعار بالريال السعودي وتشمل ضريبة القيمة المضافة. لا رسوم مخفية.',
        },
        refund: {
          title: 'استرداد عادل',
          body: 'يعود رصيد العمليات الفاشلة تلقائيًا. وتجد في سياسة الاسترداد تفاصيل المشتريات.',
        },
        keep: {
          title: 'رصيدك يبقى لك',
          body: 'الرصيد لا ينتهي، ويبقى في محفظتك حتى لو ألغيت الباقة.',
        },
      },
      notice: {
        mockTitle: 'مدفوعات تجريبية',
        mockBody:
          'يستخدم هذا الموقع صفحة دفع محاكاة. لا يُخصم أي مبلغ من أي بطاقة ولا تنتقل أموال حقيقية.',
        offTitle: 'الشراء متوقف مؤقتًا',
        offBody: 'شراء الرصيد غير متاح حاليًا. يُرجى المحاولة بعد قليل.',
      },
      faq: {
        title: 'أسئلة عن الفوترة',
        items: {
          credits: {
            question: 'ما هو الرصيد، وهل ينتهي؟',
            answer:
              'الرصيد هو وحدة تكلفة عمليات التوليد. قد تكلّف صورة سريعة رصيدًا واحدًا بينما يكلّف مقطع الفيديو أكثر، ويعرض لك الاستوديو السعر بالضبط قبل أن تبدأ. والرصيد لا ينتهي أبدًا، سواء جاء من حزمة أو باقة أو من هدية الترحيب.',
          },
          choose: {
            question: 'هل أشتري حزمة أم أشترك في باقة؟',
            answer:
              'الحزمة دفعة واحدة، وتناسب من يبدع بين حين وآخر. أما الباقة فتضيف دفعة جديدة من الرصيد كل شهر، وتناسب العمل المنتظم دون الحاجة إلى الشراء من جديد. وتعرض كل بطاقة السعر لكل ١٠٠ رصيد لتتمكن من المقارنة. يمكنك الجمع بين الاثنين، كما يمكنك إيقاف الباقة في أي وقت.',
          },
          vat: {
            question: 'هل السعر شامل ضريبة القيمة المضافة؟',
            answer:
              'نعم. كل سعر في هذه الصفحة بالريال السعودي وهو شامل ضريبة القيمة المضافة بنسبة {vat}٪. وتوضح كل بطاقة كيف ينقسم السعر إلى المبلغ الصافي والضريبة.',
          },
          renewal: {
            question: 'كيف تتجدد الباقة؟ وهل تُخصم من بطاقتي تلقائيًا؟',
            answer:
              'لا. نحن لا نحفظ بطاقتك ولا نخصم منها من تلقاء أنفسنا. قبل نهاية شهرك بنحو {days} أيام نرسل إليك بالبريد رابط دفع للشهر التالي، وينتظرك أيضًا في صفحة الفوترة. وإن انتهى الشهر دون دفع نرسل لك تذكيرًا. وعند دفع الرابط يصلك رصيد الشهر الجديد. وإن لم تدفع خلال {grace} أيام بعد نهاية الشهر تنتهي الباقة، ويبقى في محفظتك ما حصلت عليه من رصيد.',
          },
          cancel: {
            question: 'كيف ألغي الباقة؟',
            answer:
              'افتح صفحة الفوترة واختر «إلغاء الباقة». تبقى الباقة فعّالة حتى نهاية الشهر الذي دفعته، ولا نطلب منك أي دفعة أخرى، ويمكنك التراجع قبل ذلك. أما الرصيد الموجود في محفظتك فلا يُسحب منك أبدًا.',
          },
          failed: {
            question: 'ماذا لو فشلت عملية التوليد؟',
            answer:
              'يعود رصيدك إلى محفظتك تلقائيًا دون أن تطلب ذلك. والأوصاف التي يحجبها مرشّح المحتوى لا يُخصم عنها أي رصيد.',
          },
          refunds: {
            question: 'هل يمكنني استرداد مبلغ شراء؟',
            answer:
              'اطّلع على سياسة الاسترداد لتعرف ما يمكن استرداده وكيف تطلب ذلك. أما الرصيد الذي أنفقته فعلًا في عمليات التوليد فلا يمكن إرجاعه.',
          },
          payment: {
            question: 'كيف أدفع؟ وهل الدفع آمن؟',
            answer:
              'بعد اختيارك ما تريد شراءه تنتقل إلى صفحة الدفع الآمنة لدى مزوّد الدفع، وهي تعرض وسائل الدفع المتاحة لبطاقتك أو محفظتك. تُدخل بيانات البطاقة هناك ولا تصل إلى AIVORE إطلاقًا. وعند عودتك يتأكد هذا الموقع من الدفع لدى المزوّد قبل أن يضيف أي رصيد.',
          },
        },
        refundLink: 'سياسة الاسترداد',
      },
      legal: 'الأسعار شاملة ضريبة القيمة المضافة.',
    },
    card: {
      popular: 'الأكثر طلبًا',
      current: 'باقتك الحالية',
      perMonth: '/ شهريًا',
      everyMonth: 'كل شهر',
      oneTime: 'مرة واحدة',
      per100: '{price} لكل ١٠٠ رصيد',
      vatIncluded: 'شامل الضريبة: {net} + {vat} ضريبة قيمة مضافة ({percent}٪)',
      perks: {
        plan: {
          models: 'كل النماذج في الاستوديو والواجهة البرمجية',
          never: 'الرصيد لا ينتهي حتى بعد إلغاء الباقة',
          cancel: 'يمكنك الإلغاء في أي وقت، وتنتهي الباقة بنهاية الشهر الذي دفعته',
        },
        pack: {
          once: 'دفعة واحدة، بلا اشتراك',
          never: 'الرصيد لا ينتهي',
          models: 'كل النماذج في الاستوديو والواجهة البرمجية',
        },
      },
    },
    cta: {
      subscribe: 'اشترك',
      buy: 'اشترِ الآن',
      signUpToSubscribe: 'أنشئ حسابًا للاشتراك',
      signUpToBuy: 'أنشئ حسابًا للشراء',
      opening: 'جارٍ فتح صفحة الدفع…',
      currentPlan: 'باقتك الحالية',
      afterPlanEnds: 'متاحة بعد انتهاء باقتك',
      unavailable: 'غير متاح حاليًا',
      confirmEmail: 'أكّد بريدك أولًا',
    },
    confirm: {
      title: 'هل تريد الاشتراك في باقة {plan}؟',
      description: 'راجع طريقة عمل هذه الباقة قبل المتابعة.',
      price: 'السعر',
      priceValue: '{price} شهريًا شامل الضريبة',
      credits: 'الرصيد',
      creditsValue: '{credits} الآن، ثم مرة أخرى كل شهر',
      renewal: 'التجديد',
      renewalValue:
        'نرسل إليك بالبريد رابط دفع قبل نهاية شهرك بـ {days} أيام، وينتظرك أيضًا في صفحة الفوترة. ولا نخصم من بطاقتك تلقائيًا أبدًا. وإن انتهى الشهر دون دفع نرسل لك تذكيرًا.',
      cancel: 'الإلغاء',
      cancelValue:
        'يمكنك الإلغاء من صفحة الفوترة في أي وقت. تنتهي الباقة حينها بنهاية الشهر الذي دفعته، ولا ينتهي رصيدك أبدًا.',
      secure: 'ستدفع في صفحة الدفع الآمنة لدى مزوّد الدفع.',
      mock: 'هذه عملية دفع تجريبية: لا تنتقل أموال حقيقية.',
      continue: 'المتابعة إلى الدفع',
      dismiss: 'ليس الآن',
    },
    errors: {
      billingDisabled: 'شراء الرصيد غير متاح حاليًا. يُرجى المحاولة لاحقًا.',
      subscriptionExists:
        'لديك باقة بالفعل. أدرها من صفحة الفوترة، وللانتقال إلى غيرها ألغِها ثم اشترك من جديد بعد انتهاء الشهر المدفوع.',
      checkoutInProgress: 'ما زالت صفحة الدفع قيد التجهيز. انتظر قليلًا ثم حاول مرة أخرى.',
      keyReused: 'سبق استخدام عملية الدفع هذه لعنصر آخر. حاول مرة أخرى.',
      checkoutClosed: 'أُغلقت عملية الدفع أثناء تجهيزها. حاول مرة أخرى.',
      tooManyOpen:
        'لديك عدة عمليات دفع مفتوحة لم تكتمل. أكمل إحداها من صفحة الفوترة، أو انتظر حتى تنتهي صلاحيتها (خلال يوم)، ثم حاول مرة أخرى.',
      gatewayDown:
        'خدمة الدفع لا تستجيب في الوقت الحالي، ولم يُخصم أي مبلغ. حاول مرة أخرى بعد بضع دقائق.',
      dailyLimit:
        'بلغ حسابك الحد الأقصى لعمليات الدفع خلال الأربع والعشرين ساعة الماضية. حاول مرة أخرى بعد {wait}.',
      dailyLimitLater:
        'بلغ حسابك الحد الأقصى لعمليات الدفع خلال الأربع والعشرين ساعة الماضية. حاول مرة أخرى لاحقًا.',
      unauthorized: 'انتهت جلستك. سجّل الدخول من جديد للمتابعة.',
      noPaymentPage: 'تعذّر فتح صفحة الدفع، ولم يُخصم أي مبلغ. حاول مرة أخرى.',
      subscriptionEnded: 'انتهت هذه الباقة بالفعل. اشترك من جديد من صفحة الأسعار.',
      noSubscription: 'لا توجد باقة على حسابك.',
      emailNotVerified:
        'أكّد بريدك الإلكتروني قبل الشراء، فلن تتمكن من استخدام رصيدك قبل ذلك. أرسلنا رابط التأكيد عند تسجيلك، ويمكنك طلب رابط جديد من الشريط في أعلى صفحات حسابك.',
      openAccount: 'فتح حسابي',
      logIn: 'تسجيل الدخول',
      openBilling: 'فتح صفحة الفوترة',
    },
    return: {
      summary: {
        item: 'العنصر',
        amount: 'المبلغ (شامل الضريبة)',
        credits: 'الرصيد',
      },
      checking: {
        title: 'جارٍ التحقق من دفعتك…',
        body: 'يستغرق ذلك عادةً بضع ثوانٍ.',
      },
      pending: {
        title: 'بانتظار تأكيد دفعتك',
        body: 'قد يستغرق تأكيد الدفع دقيقة. يمكنك مغادرة هذه الصفحة بأمان: يُضاف رصيدك فور تأكيد الدفع، وتواصل هذه الصفحة التحقق ما دامت مفتوحة.',
        checkedAt: 'آخر تحقق عند {time}',
        long: 'يستغرق الأمر أطول من المعتاد. لا يلزمك فعل شيء: يُضاف الرصيد تلقائيًا فور أن يؤكد مزوّد الدفع العملية.',
        retrying: 'تعذّر الوصول إلى الخادم للتو، وسنواصل المحاولة.',
        checkNow: 'تحقق الآن',
        payPage: 'الانتقال إلى صفحة الدفع',
      },
      expired: {
        title: 'انتهت صلاحية عملية الدفع',
        body: 'لم تعد صفحة الدفع مفتوحة. إن لم تكن قد دفعت فابدأ من جديد، وإن كنت قد دفعت فسيُضاف الرصيد تلقائيًا فور تأكيد الدفع.',
      },
      paid: {
        title: 'تم استلام دفعتك',
        pack: 'شكرًا لك! أُضيف {credits} إلى رصيدك.',
        plan: 'شكرًا لك! باقة {plan} فعّالة الآن، وأُضيف {credits} إلى رصيدك.',
        renewal: 'شكرًا لك! تستمر باقة {plan}، وأُضيف {credits} إلى رصيدك.',
        until: 'شهرك الحالي ممتد حتى {date}.',
        balance: 'رصيدك الجديد',
        balancePending: 'جارٍ تحديث رصيدك…',
        start: 'ابدأ الإبداع',
        billing: 'عرض الفوترة',
      },
      failed: {
        title: 'لم تكتمل عملية الدفع',
        body: 'لم تتم عملية الدفع، لذا لم يُضف أي رصيد. وإن كان قد خُصم منك مبلغ فسيُضاف الرصيد تلقائيًا فور تأكيد الدفع.',
        retry: 'حاول مرة أخرى',
        billing: 'عرض الفوترة',
      },
      canceled: {
        title: 'أُغلقت عملية الدفع',
        body: 'أُغلقت عملية الدفع هذه، لذا لم يُضف أي رصيد. وإن كنت قد دفعت قبل إغلاقها فسيُضاف الرصيد تلقائيًا فور تأكيد الدفع.',
      },
      refunded: {
        title: 'تم استرداد المبلغ',
        body: 'استُردّ مبلغ هذه الدفعة وسُحب الرصيد الذي جاء معها.',
      },
      review: {
        title: 'نراجع هذه الدفعة',
        body: 'تحتاج هذه الدفعة إلى مراجعة يدوية، لذا أوقفناها مؤقتًا. لا يلزمك فعل أي شيء. وتجد في سياسة الاسترداد طريقة التواصل معنا إن احتجت مساعدة.',
        contact: 'سياسة الاسترداد',
      },
      notFound: {
        title: 'لم نجد هذا الطلب',
        body: 'لم نعثر على هذا الطلب في حسابك. تحقق من الرابط، أو افتح صفحة الفوترة لترى مدفوعاتك.',
      },
      missing: {
        title: 'لا يوجد طلب لعرضه',
        body: 'تعرض هذه الصفحة نتيجة عملية دفع. افتح صفحة الفوترة لترى مدفوعاتك، أو اختر ما تريد شراءه.',
      },
      error: {
        title: 'تعذّر التحقق من دفعتك',
      },
      seePricing: 'عرض الأسعار',
      openBilling: 'فتح صفحة الفوترة',
    },
    account: {
      title: 'الفوترة والباقات',
      description: 'رصيدك وباقتك ومدفوعاتك.',
      back: 'الحساب',
      balance: {
        title: 'رصيدك الحالي',
        note: 'الرصيد لا ينتهي.',
        buy: 'اشترِ رصيدًا',
      },
      plan: {
        title: 'باقتك',
        none: {
          title: 'لا توجد باقة بعد',
          body: 'اشترك لتحصل على رصيد جديد كل شهر، أو اشترِ حزمة لمرة واحدة كلما احتجت إلى المزيد.',
          action: 'عرض الباقات والحزم',
        },
        name: 'الباقة',
        credits: 'الرصيد',
        creditsValue: '{credits} شهريًا',
        price: 'السعر',
        priceValue: '{price} شهريًا شامل الضريبة',
        renews: 'تتجدد في',
        ends: 'تنتهي في',
        endedOn: 'انتهت في',
        periodEnded: 'انتهى هذا الشهر في',
        next: 'الدفعة القادمة',
        nextValue: '{price}، تُدفع قبل {date}',
        status: {
          active: 'فعّالة',
          canceling: 'قيد الإلغاء',
          past_due: 'الدفع مستحق',
          canceled: 'ملغاة',
          expired: 'منتهية',
          incomplete: 'بانتظار الدفع',
        },
        notes: {
          renewal:
            'يتم التجديد برابط دفع، وليس بالخصم من بطاقتك. يظهر هنا رابط الشهر القادم قبل نهاية هذا الشهر بـ {days} أيام، ونرسله إليك بالبريد أيضًا.',
          canceling:
            'تنتهي باقتك في {date}. وحتى ذلك الحين تواصل استخدام ما وصلك من رصيد، والرصيد الموجود في محفظتك لا ينتهي أبدًا. ويمكنك التراجع عن الإلغاء قبل ذلك.',
          ended: 'انتهت هذه الباقة. والرصيد الموجود في محفظتك لا ينتهي أبدًا.',
          incomplete: 'أكمل الدفعة الأولى لتبدأ هذه الباقة.',
        },
        renewalReady: {
          title: 'دفعة التجديد جاهزة',
          body: 'ادفع قبل {date} لتستمر باقتك. يصلك الرصيد فور تأكيد الدفع.',
        },
        pastDue: {
          title: 'دفعة التجديد مستحقة',
          body: 'ادفع قبل {date} لتحتفظ بباقتك. وإن لم تفعل فستنتهي الباقة، ويبقى في محفظتك ما حصلت عليه من رصيد.',
          noLink: 'رابط الدفع غير متاح في الوقت الحالي. يُرجى التحقق مرة أخرى بعد قليل.',
        },
        payNow: 'ادفع الآن',
        completePayment: 'إكمال الدفع',
        cancel: 'إلغاء الباقة',
        resume: 'استئناف الباقة',
        change: 'تغيير الباقة',
        again: 'اشترك من جديد',
        keep: 'الإبقاء على الباقة',
        cancelDialog: {
          title: 'هل تريد إلغاء باقتك؟',
          body: 'تبقى باقتك فعّالة حتى {date} ثم تنتهي. لن نطلب منك الدفع مرة أخرى، والرصيد الموجود في محفظتك لا ينتهي أبدًا. ويمكنك التراجع عن الإلغاء حتى ذلك التاريخ.',
          bodyNow:
            'دفعتك متأخرة، لذا تنتهي الباقة فورًا. والرصيد الموجود في محفظتك لا ينتهي أبدًا.',
          bodyUnpaid: 'لم تتم الدفعة الأولى بعد. سيؤدي الإلغاء إلى إغلاق صفحة الدفع.',
          confirm: 'إلغاء الباقة',
        },
        toast: {
          canceled: 'ستنتهي باقتك في {date}.',
          canceledNow: 'تم إلغاء باقتك.',
          resumed: 'ستستمر باقتك.',
        },
      },
      orders: {
        title: 'المدفوعات',
        description: 'كل ما اشتريته. المبالغ شاملة الضريبة.',
        columns: {
          date: 'التاريخ',
          item: 'العنصر',
          amount: 'المبلغ',
          status: 'الحالة',
          credits: 'الرصيد',
          actions: 'الإجراءات',
        },
        noCredits: 'لا رصيد',
        kind: {
          pack: '{name}',
          subscription_initial: 'باقة {name}، الشهر الأول',
          subscription_renewal: 'باقة {name}، تجديد',
        },
        period: 'من {from} إلى {to}',
        refunded: 'مُسترد {amount}',
        status: {
          pending: 'بانتظار الدفع',
          paid: 'مدفوع',
          failed: 'فشل',
          canceled: 'ملغى',
          refunded: 'مُسترد',
          needs_review: 'قيد المراجعة',
        },
        pay: 'ادفع',
        view: 'التفاصيل',
        loadMore: 'عرض المزيد',
        loadingMore: 'جارٍ التحميل…',
        end: 'هذا كل شيء.',
        loadFailed: 'تعذّر تحميل مدفوعاتك.',
        empty: {
          title: 'لا توجد مدفوعات بعد',
          body: 'عندما تشتري رصيدًا أو تشترك في باقة ستظهر مدفوعاتك هنا.',
          action: 'عرض الأسعار',
        },
      },
      legal: {
        title: 'الأحكام',
        prices: 'الأسعار شاملة ضريبة القيمة المضافة.',
      },
      loadFailed: 'تعذّر تحميل تفاصيل الفوترة.',
    },
  },
});
