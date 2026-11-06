import { request } from './client'
import type {
  AuthResponse,
  SecurityQuestionResponse,
  User,
  VerifyAnswerResponse,
} from '@/types'

export interface RegisterPayload {
  username: string
  password: string
  security_question: string
  security_answer: string
}

export interface LoginPayload {
  username: string
  password: string
}

export function register(payload: RegisterPayload): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/register', { method: 'POST', auth: false, body: payload })
}

export function login(payload: LoginPayload): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', { method: 'POST', auth: false, body: payload })
}

export function getSecurityQuestion(username: string): Promise<SecurityQuestionResponse> {
  return request<SecurityQuestionResponse>(
    `/auth/security-question?username=${encodeURIComponent(username)}`,
    { auth: false },
  )
}

export function verifyAnswer(payload: {
  username: string
  answer: string
}): Promise<VerifyAnswerResponse> {
  return request<VerifyAnswerResponse>('/auth/verify-answer', {
    method: 'POST',
    auth: false,
    body: payload,
  })
}

export function resetPassword(payload: {
  reset_token: string
  new_password: string
}): Promise<void> {
  return request<void>('/auth/reset-password', { method: 'POST', auth: false, body: payload })
}

export function getMe(): Promise<User> {
  return request<User>('/auth/me')
}
