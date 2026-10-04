export type ClientPlatform = 'windows-x64' | 'windows-arm64'
export type ClientReleaseChannel = 'stable' | 'beta'

export type ClientRelease = {
  id: number
  version: string
  platform: ClientPlatform
  channel: ClientReleaseChannel
  release_notes: string
  download_url: string
  file_name: string
  file_size: number
  sha256: string
  mandatory: boolean
  published: boolean
  created_by: number
  published_at: number
  created_at: number
  updated_at: number
}

export type ClientReleaseInput = Omit<
  ClientRelease,
  | 'id'
  | 'published'
  | 'created_by'
  | 'published_at'
  | 'created_at'
  | 'updated_at'
>

export type LatestClientRelease = {
  release: ClientRelease | null
  update_available: boolean
}
