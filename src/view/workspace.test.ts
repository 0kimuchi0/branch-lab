import { describe, expect, it } from 'vitest'
import { run } from '../test/run'
import { stagedFiles, workdirFiles } from './workspace'

const states = (files: ReturnType<typeof workdirFiles>) =>
  Object.fromEntries(files.map((file) => [file.path, file.state]))

describe('workdirFiles / stagedFiles', () => {
  it('作業ディレクトリはステージと、ステージは HEAD と比べる', () => {
    const repo = run([
      'echo "a" > a.txt',
      'git add a.txt',
      'echo "more" >> a.txt',
      'touch b.txt',
      'rm README.md',
    ])
    expect(states(workdirFiles(repo))).toEqual({
      'README.md': 'deleted',
      'a.txt': 'modified',
      'b.txt': 'untracked',
    })
    expect(states(stagedFiles(repo))).toEqual({ 'README.md': 'clean', 'a.txt': 'added' })
  })

  it('ステージから消したファイルは削除として表示する', () => {
    const repo = run(['git rm README.md'])
    expect(stagedFiles(repo)).toEqual([{ path: 'README.md', state: 'deleted', content: undefined }])
    expect(workdirFiles(repo)).toEqual([])
  })

  it('コンフリクトしたファイルは両方でコンフリクトとして表示する', () => {
    const repo = run([
      'git switch -c feature', 'echo "f" > README.md', 'git commit -am f',
      'git switch main', 'echo "m" > README.md', 'git commit -am m', 'git merge feature',
    ])
    expect(states(workdirFiles(repo))).toEqual({ 'README.md': 'conflict' })
    expect(states(stagedFiles(repo))).toEqual({ 'README.md': 'conflict' })
  })
})
