"use client";

import { useState } from "react";
const explorer = "https://creditcoin-testnet.blockscout.com/tx/";
const steps = [
  {
    title: "Coverage purchased",
    text: "Policy 1 reserved 100 TestUSD for the beneficiary fixed at purchase. The premium and payout conditions were locked on Creditcoin.",
    href:
      explorer +
      "0x70e7184d8c7479960827a2f5056e8624a7b95fc49ba0e69af6597d3a588fd7fe",
    link: "View the purchase",
  },
  {
    title: "Two price observations",
    text: "Ethereum rounds 1171 and 1172 reported $0.99985 and $0.99979. Both met this demo policy’s threshold and occurred within coverage, more than five minutes apart.",
    href: "https://etherscan.io/tx/0x4876a2e3b835394a51fcab498775821df3c29e817481a890cba24a10a7ae9e32",
    link: "View the first observation",
  },
  {
    title: "Evidence verified on Creditcoin",
    text: "One claim transaction verified both Ethereum receipts through Attestcoin and checked the policy’s price, timing, beneficiary, and reserve rules.",
    href:
      explorer +
      "0xc509b3577ebd9cbe3bc65d515e46d90ee88e58a0c97bdf43ae35c338b8ababb5",
    link: "View the verification transaction",
  },
  {
    title: "100 TestUSD paid",
    text: "The pool transferred exactly 100 TestUSD to the locked beneficiary and marked policy 1 Claimed. This policy cannot pay again.",
    href:
      explorer +
      "0xc509b3577ebd9cbe3bc65d515e46d90ee88e58a0c97bdf43ae35c338b8ababb5",
    link: "View the payout transfer",
  },
];

export function CompletedPayout() {
  const [selected, setSelected] = useState(0);
  const step = steps[selected]!;
  return (
    <section
      className="section payout-walkthrough"
      id="completed-payout"
      aria-labelledby="completed-heading"
    >
      <div className="section-heading">
        <h2 id="completed-heading">Follow a completed payout.</h2>
        <p>
          A recorded transaction on CC3 testnet. Explore each step without a
          wallet.
        </p>
      </div>
      <div className="walkthrough-layout">
        <ol className="walkthrough-steps" aria-label="Payout walkthrough steps">
          {steps.map((item, index) => (
            <li key={item.title}>
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-pressed={index === selected}
                aria-controls="walkthrough-detail"
              >
                <span>0{index + 1}</span>
                {item.title}
              </button>
            </li>
          ))}
        </ol>
        <article
          id="walkthrough-detail"
          className="walkthrough-detail"
          aria-live="polite"
        >
          <span className="mono-label">
            Recorded example · policy 1 · step {selected + 1} of 4
          </span>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
          <a
            className="button ghost"
            href={step.href}
            target="_blank"
            rel="noreferrer"
          >
            {step.link} ↗
          </a>
          {selected === 1 && (
            <a
              className="evidence-link"
              href="https://etherscan.io/tx/0x53bb235fb9f71f983e1d602eaedd9a834e153783e50828b23b65750540c451b9"
              target="_blank"
              rel="noreferrer"
            >
              View the confirmation ↗
            </a>
          )}
        </article>
      </div>
      <p className="demo-disclosure">
        Demonstration threshold: $1.00989675. These ordinary market observations
        demonstrate the payout mechanism, not an actual economic USDC depeg.
        TestUSD has no real monetary value.
      </p>
    </section>
  );
}
