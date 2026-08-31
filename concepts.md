# Concepts

Plain-language explanations of the ideas behind this project, for anyone who wants to understand *why* it's built the way it is, not just what it does.

## What's a CMDB?

CMDB stands for **Configuration Management Database**. Think of it as a company's master inventory of everything in its IT environment, servers, applications, databases, network gear, cloud resources, and how they all connect to each other.

Most companies start this as a spreadsheet. That works until the spreadsheet goes stale, which happens almost immediately, someone spins up a new server, nobody updates the sheet, and now the "source of truth" is wrong. A good CMDB is kept accurate automatically, through discovery, rather than by someone remembering to type it in.

## What's "discovery"?

Discovery is the process of automatically finding what infrastructure actually exists, rather than trusting what's written down. It usually happens in one of two ways:

- **Agentless**: nothing is installed on the target. A discovery tool reaches in from outside, over the network (credentialed scans, asking a cloud provider's own API what it has running) or by querying management interfaces. Fast to roll out broadly, but shallower.
- **Agent-based**: a small piece of software is installed and runs continuously on the target machine itself, reporting its own state back. Richer, more continuous visibility, but has to be installed and maintained everywhere it runs.

Real systems typically combine both, agentless for broad, fast coverage, agent-based for deep, continuous detail on things that matter most.

## Why a graph instead of a table?

A spreadsheet is great at listing things. It's bad at answering *"what depends on this?"* or *"what breaks if this goes down?"*, because those questions require following chains of relationships, and chains of relationships don't fit neatly into rows and columns.

A **graph database** stores data as nodes (things) and edges (relationships between things) natively, and can traverse those relationships directly. Asking "what depends on this database, and what depends on those things, and so on" is a natural query in a graph database, and a genuinely awkward one in a table-based one.

## What's "blast radius"?

If a piece of infrastructure fails, its **blast radius** is everything that gets affected as a result, directly or through a chain of dependencies. Knowing the blast radius of a change *before* making it (a deploy, a restart, a decommission) is how experienced operations teams avoid surprises. It's a graph-traversal problem: start at the thing that might fail, and walk outward through everything that depends on it.

## Deterministic vs. agentic reasoning

When two sources of information disagree about something, someone or something has to decide which one to trust. There are two broad approaches:

- **Deterministic (rule-based)**: a fixed rule decides, every time, the same way. For example, "always trust whichever source reported most recently." Predictable, easy to audit, easy to explain, but rigid, it can't account for context a rule-writer didn't anticipate.
- **Agentic (AI-judged)**: a language model looks at the actual evidence and reasons about which source to trust, case by case, explaining its reasoning in plain language. More flexible and can weigh nuance a fixed rule would miss, but less predictable and harder to audit at scale.

Neither is strictly better, it's a real trade-off between predictability and flexibility, and the right choice depends on how much the decision matters and how well it can be reduced to a rule in the first place.

## Serverless functions

A **serverless function** is a small piece of backend code that only runs when something asks for it. There's no server sitting on and idling around the clock, the hosting platform spins the code up for a moment, runs it, returns an answer, and shuts it back down. This project's backend logic (querying the database, running discovery, calling an AI model) is built this way.

## Environment variables

Code that needs a secret, a database password, an API key, shouldn't have that secret written directly into it, especially if the code is public. An **environment variable** is a value kept in the hosting platform's private settings instead, which the running code can read at the moment it needs it. The secret never has to appear in the source code itself.

## Continuous deployment

Rather than manually uploading a new version of a site every time something changes, a repository can be **linked** to a hosting platform so that every change pushed to it automatically triggers a new build and goes live. This removes a manual step and means the live version and the latest code are never out of sync (as long as the change built successfully).

## Force-directed graph layout

The graph in this project isn't laid out by hand, it's simulated with **physics**: nodes repel each other like magnets, while relationships pull connected nodes together like springs, and the whole thing settles into a stable layout on its own. This is why it moves and "breathes" rather than sitting frozen, and why adding a new node causes the rest of the graph to gently resettle around it.
