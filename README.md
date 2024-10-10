# Durable workflows implemented on Edge.

Durable is a workflow engine for building **workflows as a code** on top of Deno runtime. Durable workflows allows you to create long running persistent workflows using your preferred language with automatic recover from failures.

## How it works

Durable workflows are a type of workflow that are designed to survive failures and continue from where they left off. In other words, they are able to persist their state and continue executing even in the case of a system failure.

In the Durable project, durable workflows are implemented using Deno and a stateful [event-driven architecture](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing). The workflows are comprised of functions called "activities" that are executed in a specific order and communicate with each other through commands. The state of the workflows is stored in a persistent database, ensuring that the workflows can continue executing even after a system failure.

Each workflow is implemented as a separate module in your preferable language and can be updated and deployed independently of the rest of the workflow engine. This makes it easy to evolve the workflows over time without having to make changes to the entire system and create an ecosystem of reusable workflows acoss the OSS community.

In summary, Durable workflows offer a simple and reliable way to implement workflows on edge devices, providing durability, scalability, and the ability to evolve over time.

### Workflows made easy

Workflows are functions that generates `Commands`, a workflow may have an input or not.
