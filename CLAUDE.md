# CLAUDE.md

## Project

| Path        | Contents                                         |
|-------------|--------------------------------------------------|
| `frontend/` | React Native mobile app (iOS and Android)        |
| `backend/`  | Go API, runs on Amazon ECS                       |
| `infra/`    | AWS infrastructure                               |
| `docs/`     | Documentation, including architecture diagrams   |

Read `docs/architecture/aws-infrastructure.md` before any change that touches more than one of these parts, or touches AWS resources.

Documentation lives in the root `docs/` directory. Don't add `docs/` directories or `README.md` files inside `frontend/`, `backend/`, or `infra/`. Instructions for working on one part go in that part's own `CLAUDE.md` (e.g. `backend/CLAUDE.md`).

## Business requirements

`docs/requirements/business-requirements.md` is the single source of truth for what the app does. Read it before building or changing a feature, and cite the requirement IDs you implement (e.g. `BR-EXP-01`) in code comments, tests, and PR descriptions.

**Every addition, change, or deletion of a business requirement must update `docs/requirements/business-requirements.md` in the same change.** This applies whether it comes from the user in conversation, from a decision made while implementing, or from a code change that alters user-facing behavior or a calculation. Never leave the document behind the code or the conversation.

- **Adding:** give the requirement the next free ID in its group (e.g. `BR-EXP-12`), and keep rows in ID order. For a new area, add a new group with its own prefix.
- **Changing:** edit the row in place and keep its ID.
- **Deleting:** remove the row and never reuse its ID. If the requirement is only postponed, move it to **Future** instead.
- **Update everything the change touches:** the Glossary, Scope, Calculations and worked example, seed-data tables, cross-references to other IDs, Assumptions, and Future. Then search the code and tests for the affected IDs and update them too.
- **Don't present a guess as a decision.** Anything the user hasn't decided goes in the Assumptions table. When it's decided, write it into the requirements and remove the row.
- **Promoting a Future item** into the release turns it into a numbered requirement and removes it from Future.
- If a request conflicts with an existing requirement, point out the conflict and ask before changing either.

## Frontend

See `frontend/CLAUDE.md` for commands, layout, and code and testing conventions.

## Backend

See `backend/CLAUDE.md` for commands, architecture rules, and testing conventions.

## Architecture diagrams

Architecture docs live in `docs/architecture/` as Markdown with Mermaid diagrams. They need to work for both people and AI: people see the rendered picture, AI reads the text. Never use image files (PNG, draw.io, Figma) as the source of a diagram.

`docs/architecture/aws-infrastructure.md` is the reference example. Follow its structure.

### Sections, in this order

1. **Title and summary:** one sentence on what the doc covers, plus bullets for **Stack**, **Scope** (what's in and out), and **Code paths**.
2. **Diagram:** one Mermaid `flowchart LR` block, then one sentence explaining what each line style means.
3. **Components:** table with `ID | Resource | Placement | Responsibility`.
4. **Connections:** table with `From | To | Protocol / Port | Purpose`. One row per arrow in the diagram.
5. **Security groups:** table with `Security group | Inbound rule`. Name the source security group (e.g. `alb-sg`), not a CIDR, wherever possible.
6. **Request flow:** numbered steps in plain sentences that match the numbered arrows.
7. **Assumptions:** table with `Item | Assumption` for anything not yet decided. When a decision is made, update the doc everywhere it applies and remove the row.
8. **Not shown in the diagram:** what was left out to keep the diagram simple, and why (e.g. multiple AZs, NAT gateway or VPC endpoints, ECR, CloudWatch Logs, Secrets Manager, IAM).

### Diagram rules

- **Nest subgraphs to show placement:** `AWS Cloud` > `Region` > `VPC` > `Public subnet` / `Private subnet`. Put global services (Route 53) outside `Region`, and regional services that aren't in the VPC (WAF) inside `Region` but outside `VPC`.
- **Use stable, short, lowercase node IDs** (`alb`, `ecs`, `rds`). The same ID must appear in the Components, Connections, and Security groups tables, written in backticks.
- **Quote every label** (`alb["Application Load Balancer"]`) and use `<br/>` for a second line with details (`ecs["ECS Service<br/>1 task: Go API"]`).
- **Shapes:** `[( )]` for databases, `[" "]` for everything else.
- **Label every arrow** with its protocol and port (`"HTTPS :443"`, `"PostgreSQL :5432"`). Never leave an arrow unlabeled.
- **Solid arrows (`-->`) are traffic; dashed arrows (`-.->`) are configuration links** such as a DNS alias or a WAF association.
- **Number traffic arrows in request order** (`"1. DNS lookup"`, `"2. HTTPS :443"`) so they match the Request flow section.
- **Keep it to about 15 nodes or fewer.** If it gets bigger, split it into separate docs.
- **No styling** (`classDef`, colors). It clutters the source and can be unreadable in dark mode.

### Keeping docs accurate

- Update the architecture doc in the same change as any change to AWS resources, ports, or the tech stack.
- Don't present a guess as a decision. Anything the user hasn't specified goes in the Assumptions table.
- Before finishing, check that every diagram renders:

  ```sh
  npx -y -p @mermaid-js/mermaid-cli mmdc -i docs/architecture/<file>.md -o "$(mktemp -d)/out.md"
  ```
