# Acme Bank — Living Infrastructure Graph

A live, physics-based visualization of a fictional bank's IT infrastructure, modeling the same discovery / CMDB / dependency-mapping problem that ITOM platforms solve for real enterprises.

**Live demo:** https://acme-bank-living-graph.netlify.app

## What it does

- Renders Acme Bank's infrastructure (applications, databases, load balancers, servers, storage) as a live, moving graph, nodes drift and settle like Obsidian's graph view, not a static diagram
- **Simulate Asset Discovery**: adds a newly "discovered" server into the graph live, connected to its host application, the same pattern real Discovery tools use when they find untracked infrastructure
- **Blast-radius highlighting**: click any node to see everything that depends on it, directly or transitively, light up while everything unrelated dims. Click empty space to reset
- Light/dark theme toggle

## Why this exists

Most CMDBs are just tables. The relationships between infrastructure, what depends on what, matter as much as the inventory itself, and are what make questions like "what breaks if this database goes down" answerable. This project treats that relationship data as a real graph (Neo4j, queried with Cypher) instead of flattening it into rows.

## Stack

- **Neo4j AuraDB** (free tier) for the graph data store
- **vis-network** for the physics-based rendering
- **Netlify Functions** (serverless) as the query layer between the frontend and Neo4j
- Deployed on **Netlify**, continuous deployment from this repo

## Data model

**Node types:** Application, Database, Load Balancer, Server, Storage
**Relationship types:** `depends_on`, `connects_to`, `routes_to`, `inherits_from`
