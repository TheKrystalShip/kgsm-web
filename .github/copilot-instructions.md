# GitHub Copilot Instructions for React Project

## General Guidelines

- **Follow CLEAN Code Standards**: Write code that is easy to read, understand, and maintain. Use meaningful names, keep functions short, and avoid unnecessary complexity.
- **Component Design**: Build React components that are reusable, loosely coupled, and focused on a single responsibility.
- **Use Latest React and JavaScript/TypeScript Features**: Target the latest stable version of React. Use modern JavaScript (ES2022+) or TypeScript features (e.g., arrow functions, destructuring, optional chaining, nullish coalescing).
- **Documentation**: Add JSDoc or TypeScript comments and inline documentation that describe the intent and purpose of code, not just what it does.

## Coding Practices

- **Naming**: Use PascalCase for components and classes. Use camelCase for variables, functions, and props.
- **File Organization**: One component per file. Organize files by feature or domain.
- **Hooks**: Prefer functional components and React hooks (`useState`, `useEffect`, `useCallback`, etc.) over class components.
- **Async/Await**: Prefer asynchronous programming for I/O-bound operations.
- **Error Handling**: Use try-catch blocks judiciously. Log errors with meaningful messages.
- **Validation**: Validate user input both on client and server sides.
- **Separation of Concerns**: Keep UI, business logic, and data access separate (e.g., use custom hooks for data fetching).
- **Services**: Use service classes or modules for data fetching and business logic. Avoid placing API calls directly in components.
- **State Management**: Use React's built-in state management for local state. For global state, consider using Context API, Redux, or Zustand.
- **Components**: Components should be small and focused. Avoid large monolithic components.
- **Views**: Views should never contain business logic. They should only render UI based on props and state.
- **Styles**: Use CSS Modules, styled-components, or emotion for styling. Avoid inline styles unless necessary.

## React-Specific Best Practices

- **Props and State**: Use props for parent-child communication and state for local component data.
- **PropTypes/TypeScript**: Use PropTypes or TypeScript interfaces for component props validation.
- **Event Handling**: Use event handler naming conventions (e.g., `handleClick`, `onChange`).
- **Context API**: Use React Context for global state only when necessary. Prefer local state or state management libraries for complex scenarios.
- **CSS Modules or CSS-in-JS**: Use CSS Modules, styled-components, or emotion for component-scoped styles.
- **Accessibility**: Follow accessibility best practices (ARIA attributes, semantic HTML).

## Documentation

- **JSDoc/TypeScript Comments**: Document components, functions, and complex logic with clear comments.
- **README**: Maintain a project-level README with setup, usage, and contribution guidelines.

## References

- [React Documentation](https://react.dev/)
- [JavaScript Style Guide](https://github.com/airbnb/javascript)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [CLEAN Code](https://github.com/ryanmcdermott/clean-code-javascript)
- [Accessibility in React](https://react.dev/learn/accessibility)
