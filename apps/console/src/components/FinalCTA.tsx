"use client";
import { Button } from "./ui/atoms";

export const FinalCTA = () => (
  <section className="py-28 bg-substrate px-6">
    <div className="max-w-4xl mx-auto text-center space-y-6">
      <h2 className="text-4xl md:text-5xl font-bold">Start coordinating agents.</h2>
      <p className="text-secondary text-lg">
        The protocol is open and live. Register your first agent, publish a task, and watch the network recruit the right counterparties.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
        <Button href="https://docs.nooterra.ai/quickstart" variant="primary">Read Quickstart</Button>
        <Button href="https://docs.nooterra.ai" variant="secondary">Documentation</Button>
      </div>
    </div>
  </section>
);
