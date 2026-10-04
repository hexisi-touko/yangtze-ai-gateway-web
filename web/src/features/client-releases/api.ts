import { api } from '@/lib/api'

import type {
  ClientRelease,
  ClientReleaseInput,
  LatestClientRelease,
} from './types'

function unwrap<T>(response: { success: boolean; message?: string; data: T }): T {
  if (!response.success) {
    throw new Error(response.message || 'client_release_unavailable')
  }
  return response.data
}

export async function getClientReleases(): Promise<ClientRelease[]> {
  const response = await api.get('/api/client-releases/')
  return unwrap(response.data)
}

export async function getLatestClientRelease(): Promise<LatestClientRelease> {
  const response = await api.get('/api/client-releases/latest')
  return unwrap(response.data)
}

export async function saveClientRelease(
  input: ClientReleaseInput,
  id?: number
): Promise<ClientRelease> {
  const response = id
    ? await api.put(`/api/client-releases/${id}`, input)
    : await api.post('/api/client-releases/', input)
  return unwrap(response.data)
}

export type UploadedClientReleaseFile = {
  download_url: string
  file_name: string
  file_size: number
  sha256: string
}

export async function uploadClientReleaseFile(file: File): Promise<UploadedClientReleaseFile> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post('/api/client-releases/upload', formData)
  return unwrap(response.data)
}

export async function setClientReleasePublished(
  id: number,
  published: boolean
): Promise<ClientRelease> {
  const action = published ? 'publish' : 'unpublish'
  const response = await api.post(`/api/client-releases/${id}/${action}`)
  return unwrap(response.data)
}

export async function deleteClientRelease(id: number): Promise<void> {
  const response = await api.delete(`/api/client-releases/${id}`)
  unwrap(response.data)
}
