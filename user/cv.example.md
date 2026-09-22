---
name: Alex Chen
header:
  - text: "mobile: +1 415 555 0192"
  - text: "portfolio: alexchen.dev"
    link: https://alexchen.dev
  - text: "email: alex.chen@example.com"
    link: mailto:alex.chen@example.com
  - text: "linkedin: linkedin.com/in/alex-chen-dev"
    link: https://www.linkedin.com/in/alex-chen-dev/
---

## Summary

Backend engineer with 3 years building production APIs in Python at two companies, with hands-on AWS deployment and a full-stack track record in React and TypeScript. Owns features from database schema to browser UI without needing a separate frontend handoff.

## Skills

Programming Languages
  ~ **Python**, **TypeScript**, JavaScript, Go, SQL

Front-end
  ~ **React**, **TypeScript**, Next.js, Tailwind CSS, Redux, HTML5, CSS3

Back-end
  ~ **FastAPI**, **Django**, RESTful API, Node.js, Express, OpenAPI

Database
  ~ **PostgreSQL**, **Redis**, MySQL, MongoDB, DynamoDB, Prisma

Cloud & Tools
  ~ **AWS** (ECS, Lambda, S3, SQS, ElastiCache, CloudWatch, ALB, Auto Scaling), Docker, Git, GitHub Actions, Terraform

## Experience

**Software Engineer**
  ~ San Francisco, CA (Remote)

DataFlow Inc
  ~ Mar 2023 – Present

B2B analytics platform processing 50M+ events per day for mid-market e-commerce clients.

*Stack: Python, FastAPI, PostgreSQL, Redis, React, TypeScript, AWS ECS, Docker*

- Rebuilt the ingestion API in FastAPI, cutting median response time from 340ms to 95ms under peak load
- Designed a PostgreSQL schema with pgvector for semantic search across 8M product records; reduced query time by 60%
- Set up AWS ECS cluster with ALB and Auto Scaling; configured CloudWatch alarms that cut mean time to detection from 25 min to 4 min
- Built React dashboard for real-time event monitoring, replacing a third-party tool and saving $18k/year in licensing fees
- Introduced GitHub Actions CI pipeline with Pytest and Playwright; test coverage went from 31% to 84%

**Junior Software Engineer**
  ~ Austin, TX

ShopCo
  ~ Jun 2021 – Feb 2023

E-commerce platform with 200k active monthly users.

*Stack: Python, Django, React, MySQL, Redis, Docker, GitHub Actions*

- Developed product catalogue API in Django REST Framework serving 1.2M requests per day with Redis caching
- Built responsive storefront components in React and Redux; improved Lighthouse performance score from 58 to 91
- Implemented JWT authentication and role-based access control for a merchant admin portal used by 3,000 sellers
- Containerised legacy services with Docker and migrated them to GitHub Actions CI/CD, reducing deploy time from 45 min to 8 min
- Wrote integration tests with Pytest achieving 78% coverage on all new API endpoints

## Projects

**PriceWatch** — Personal Project
[github.com/alexchen/pricewatch](https://github.com/alexchen/pricewatch) · [Live Demo](https://pricewatch.alexchen.dev)

*Stack: Python, FastAPI, PostgreSQL, React, TypeScript, AWS Lambda, SQS*

- Built a price tracking tool that monitors 500+ product URLs and sends alerts via email and Slack when prices drop
- Serverless scraping layer on AWS Lambda triggered by SQS, handling 10k checks per day at under $3/month infra cost
- React frontend with TypeScript for managing watchlists and viewing price history charts

## Certification

**AWS Certified Solutions Architect — Associate**
  ~ Sep 2023

## Education

**University of Texas at Austin**
  ~ Sep 2017 – May 2021

B.S. in Computer Science
