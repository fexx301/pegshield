"use client";

import { useState } from "react";
const explorer = "https://creditcoin-testnet.blockscout.com/tx/";
const steps = [
  {
    title: "Coverage purchased",
    text: "Policy 1 reserved 100 TestUSD for the beneficiary fixed at purchase. The premium and payout conditions were locked on Creditcoin.",
    href:
      explorer +
      "0x39359aab37bc067b62bd224dde98f05407bf72dbb90e19053a72dfe0ce0512f2",
    link: "View the purchase",
  },
  {
    title: "Two price observations",
    text: "Ethereum rounds 1187 and 1188 reported $0.99986193 and $0.99986417. Both met this demo policy’s threshold and occurred within coverage, one hour apart.",
    href: "https://etherscan.io/tx/0x622e76dad1762307848c53d5554e2f54526107b3a4df486e4ea9441e8adfe02d",
    link: "View the first observation",
  },
  {
    title: "Evidence verified on Creditcoin",
    text: "One v4 claim transaction verified both Ethereum receipts through Attestcoin and checked the policy’s price, timing, beneficiary, and reserve rules.",
    href:
      explorer +
      "0x575030ff19daffcbbc004f66fdf00cd1489341b3de80bcc424c5a32acc2120c8",
    link: "View the verification transaction",
  },
  {
    title: "100 TestUSD paid",
    text: "The pool transferred exactly 100 TestUSD to the locked beneficiary and marked policy 1 Claimed. This policy cannot pay again.",
    href:
      explorer +
      "0x575030ff19daffcbbc004f66fdf00cd1489341b3de80bcc424c5a32acc2120c8",
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
          A current v4 settlement on CC3 testnet. Explore each step without a
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
            Recorded example · v4 policy 1 · step {selected + 1} of 4
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
              href="https://etherscan.io/tx/0x6601d8b8013f791c7f73a19105b4ac3308d11ce05348cd80c6d5742c403a61b0"
              target="_blank"
              rel="noreferrer"
            >
              View the confirmation ↗
            </a>
          )}
        </article>
      </div>
      <p className="demo-disclosure">
        Demonstration threshold: $1.00983312. These ordinary market observations
        demonstrate the payout mechanism, not an actual economic USDC depeg.
        TestUSD has no real monetary value.
      </p>
    </section>
  );
}
