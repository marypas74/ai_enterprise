import { describe, it, expect } from 'vitest';
import { AppError, NotFoundError, ForbiddenError, ValidationError, UnauthorizedError } from './index.js';

describe('AppError', () => {
  it('should create an error with status code and message', () => {
    const err = new AppError(400, 'Bad request');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Bad request');
    expect(err.details).toBeUndefined();
  });

  it('should include optional details', () => {
    const details = [{ field: 'email', message: 'required' }];
    const err = new AppError(400, 'Validation failed', details);
    expect(err.details).toEqual(details);
  });
});

describe('Specialized errors', () => {
  it('NotFoundError should have 404', () => {
    const err = new NotFoundError('User not found');
    expect(err.statusCode).toBe(404);
  });

  it('ForbiddenError should have 403', () => {
    const err = new ForbiddenError();
    expect(err.message).toBe('Access denied');
    expect(err.statusCode).toBe(403);
  });

  it('ValidationError should include Zod details', () => {
    const details = [{ path: ['email'], message: 'Invalid email' }];
    const err = new ValidationError(details);
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual(details);
  });

  it('UnauthorizedError should have 401', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
  });
});
