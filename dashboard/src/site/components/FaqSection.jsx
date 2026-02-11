const faqs = [
  {
    q: "Is this a payment network?",
    a: "Settld is an enforcement layer: it decides whether money should move based on signed terms and evidence. Payment rails are adapters."
  },
  {
    q: "What does offline-verifiable mean?",
    a: "You can export a closepack and verify signatures, bindings, and evaluation without calling Settld servers."
  },
  {
    q: "What is Kernel v0's first canonical transaction?",
    a: "Paid capability calls: agreement -> hold -> evidence -> decision -> receipt, with holdbacks and disputes."
  },
  {
    q: "Is it open?",
    a: "Protocol objects and conformance vectors are open. Hosted control plane features are offered separately."
  }
];

export default function FaqSection() {
  return (
    <section className="section-shell">
      <div className="section-heading">
        <p className="eyebrow">FAQ</p>
        <h2>Direct answers for launch questions.</h2>
      </div>
      <div className="faq-list">
        {faqs.map((item) => (
          <details key={item.q} className="faq-item">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
