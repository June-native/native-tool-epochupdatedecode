import './style.css'
import { Interface, formatUnits, isHexString } from 'ethers'
import creditVaultAbi from '../CreditVault.json'

const iface = new Interface(creditVaultAbi)
const DECIMAL_CANDIDATES = [18, 8, 6]

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="container">
    <h1>epochUpdate Calldata Decoder</h1>
    <p class="subtitle">Paste calldata for <code>epochUpdate</code>. Decoding updates live.</p>

    <label for="calldata">Calldata</label>
    <textarea id="calldata" placeholder="0x..."></textarea>

    <label for="slackReport">Slack Epoch Report</label>
    <textarea id="slackReport" class="report-input" placeholder="Paste the automated Slack report message..."></textarea>

    <p id="status" class="status">Waiting for input.</p>
    <div id="reportCheck" class="report-check"></div>
    <div id="results" class="results"></div>
  </main>
`

const calldataInput = document.querySelector('#calldata')
const slackReportInput = document.querySelector('#slackReport')
const status = document.querySelector('#status')
const reportCheck = document.querySelector('#reportCheck')
const results = document.querySelector('#results')

function normalizeHex(value) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`
}

function getNormalizedAmounts(raw) {
  return {
    oneE6: formatUnits(raw, 6),
    oneE8: formatUnits(raw, 8),
    oneE18: formatUnits(raw, 18),
  }
}

function normalizeNumericString(value) {
  const compact = value.replaceAll(',', '').trim()
  if (!compact) {
    return ''
  }

  const [rawInt = '0', rawFrac = ''] = compact.split('.')
  const normalizedInt = rawInt.replace(/^0+(?=\d)/, '') || '0'
  const normalizedFrac = rawFrac.replace(/0+$/, '')
  return normalizedFrac ? `${normalizedInt}.${normalizedFrac}` : normalizedInt
}

function getCurrentMonthDay() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

function buildCountMap(values) {
  const counts = new Map()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

function consumeFromCountMap(counts, key) {
  const current = counts.get(key) ?? 0
  if (current <= 0) {
    return false
  }
  counts.set(key, current - 1)
  return true
}

function roundDecimals(value, precision) {
  const normalized = normalizeNumericString(value)
  if (!normalized.includes('.')) {
    return normalized
  }

  const [intPart, fracPart] = normalized.split('.')
  if (precision <= 0) {
    const shouldCarry = Number(fracPart[0] ?? '0') >= 5
    if (!shouldCarry) {
      return intPart
    }
    return (BigInt(intPart) + 1n).toString()
  }

  if (fracPart.length <= precision) {
    return normalized
  }

  const keptDigits = fracPart.slice(0, precision).split('')
  const nextDigit = Number(fracPart[precision] ?? '0')
  if (nextDigit >= 5) {
    let index = keptDigits.length - 1
    while (index >= 0) {
      const current = Number(keptDigits[index])
      if (current < 9) {
        keptDigits[index] = String(current + 1)
        break
      }
      keptDigits[index] = '0'
      index -= 1
    }

    if (index < 0) {
      const incrementedInt = (BigInt(intPart) + 1n).toString()
      const roundedFrac = keptDigits.join('').replace(/0+$/, '')
      return roundedFrac ? `${incrementedInt}.${roundedFrac}` : incrementedInt
    }
  }

  const roundedFrac = keptDigits.join('').replace(/0+$/, '')
  return roundedFrac ? `${intPart}.${roundedFrac}` : intPart
}

function getAmountCandidates(amount) {
  return DECIMAL_CANDIDATES.map((decimals) => ({
    decimals,
    normalized: normalizeNumericString(formatUnits(amount, decimals)),
  }))
}

function getRoundedCandidates(exactCandidates) {
  const variantsByValue = new Map()
  for (const candidate of exactCandidates) {
    for (const precision of [8, 6, 4, 2]) {
      const rounded = roundDecimals(candidate.normalized, precision)
      if (!rounded || variantsByValue.has(rounded)) {
        continue
      }
      variantsByValue.set(rounded, {
        normalized: rounded,
        sourceDecimals: candidate.decimals,
        precision,
      })
    }
  }
  return [...variantsByValue.values()]
}

function renderReportCheck(rows, reportText) {
  const trimmedReport = reportText.trim()
  if (!trimmedReport) {
    reportCheck.className = 'report-check'
    reportCheck.innerHTML = '<p>Paste the Slack report to automatically check date and decoded values.</p>'
    return
  }

  const dateTag = getCurrentMonthDay()
  const dateOk = trimmedReport.includes(dateTag)
  const reportNumbers = (trimmedReport.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map(normalizeNumericString)
    .filter(Boolean)

  const reportCounts = buildCountMap(reportNumbers)
  const missingRows = []
  const matchedRows = []

  for (const row of rows) {
    const exactCandidates = getAmountCandidates(row.amount)
    const roundedCandidates = getRoundedCandidates(exactCandidates)
    const candidateSummary = exactCandidates.map((candidate) => `1e${candidate.decimals}:${candidate.normalized}`).join(' | ')

    let matchedValue = ''
    let matchedMode = ''
    let matchedDecimals = null
    let matchedPrecision = null

    for (const candidate of exactCandidates) {
      if (consumeFromCountMap(reportCounts, candidate.normalized)) {
        matchedValue = candidate.normalized
        matchedMode = 'exact'
        matchedDecimals = candidate.decimals
        break
      }
    }

    if (!matchedValue) {
      for (const rounded of roundedCandidates) {
        if (consumeFromCountMap(reportCounts, rounded.normalized)) {
          matchedValue = rounded.normalized
          matchedMode = 'rounded'
          matchedDecimals = rounded.sourceDecimals
          matchedPrecision = rounded.precision
          break
        }
      }
    }

    if (matchedValue) {
      matchedRows.push({
        ...row,
        matchedValue,
        matchedMode,
        matchedDecimals,
        matchedPrecision,
      })
    } else {
      missingRows.push({
        ...row,
        candidateSummary,
      })
    }
  }

  if (!dateOk || missingRows.length > 0) {
    reportCheck.className = 'report-check error'
  } else {
    reportCheck.className = 'report-check success'
  }

  const missingContent =
    missingRows.length === 0
      ? '<li>No missing decoded amounts.</li>'
      : missingRows
          .map((row) => `<li><span class="mono">${row.token}</span> (${row.feeType}): <span class="mono">${row.candidateSummary}</span></li>`)
          .join('')

  const matchedContent =
    matchedRows.length === 0
      ? '<li>No matched values yet.</li>'
      : matchedRows
          .map(
            (row) =>
              `<li><span class="mono">${row.token}</span> (${row.feeType}): <span class="match-hit mono">1e${row.matchedDecimals} -> ${row.matchedValue}${row.matchedMode === 'rounded' ? ` (rounded ${row.matchedPrecision}dp)` : ''}</span></li>`
          )
          .join('')

  reportCheck.innerHTML = `
    <p><strong>Date check:</strong> ${dateOk ? 'PASS' : `FAIL (missing ${dateTag})`}</p>
    <p><strong>Value check:</strong> ${matchedRows.length} matched, ${missingRows.length} missing.</p>
    <p><strong>Matched decimal results:</strong></p>
    <ul class="check-list">
      ${matchedContent}
    </ul>
    <p><strong>Missing decoded amounts:</strong></p>
    <ul class="check-list">
      ${missingContent}
    </ul>
  `
}

function renderRows(rows) {
  const content = rows
    .map((row) => {
      const normalized = getNormalizedAmounts(row.amount)
      return `
        <article class="row">
          <div><strong>Trader:</strong> <span class="mono">${row.trader}</span></div>
          <div><strong>Token:</strong> <span class="mono">${row.token}</span></div>
          <div><strong>Type:</strong> ${row.feeType}</div>
          <div><strong>Amount raw:</strong> <span class="mono">${row.amount.toString()}</span></div>
          <div><strong>1e6:</strong> <span class="mono">${normalized.oneE6}</span></div>
          <div><strong>1e8:</strong> <span class="mono">${normalized.oneE8}</span></div>
          <div><strong>1e18:</strong> <span class="mono">${normalized.oneE18}</span></div>
        </article>
      `
    })
    .join('')

  results.innerHTML = content
}

function decodeCalldata(input) {
  const data = normalizeHex(input)

  if (!data) {
    status.textContent = 'Waiting for input.'
    status.className = 'status'
    results.innerHTML = ''
    renderReportCheck([], slackReportInput.value)
    return
  }

  if (!isHexString(data)) {
    status.textContent = 'Invalid hex calldata.'
    status.className = 'status error'
    results.innerHTML = ''
    renderReportCheck([], slackReportInput.value)
    return
  }

  try {
    const decoded = iface.decodeFunctionData('epochUpdate', data)
    const accruedFees = decoded[0]
    const rows = []

    for (const feeByTrader of accruedFees) {
      for (const feeUpdate of feeByTrader.feeUpdates) {
        if (feeUpdate.fundingFee !== 0n) {
          rows.push({
            trader: feeByTrader.trader,
            token: feeUpdate.token,
            feeType: 'fundingFee',
            amount: feeUpdate.fundingFee,
          })
        }
        if (feeUpdate.reserveFee !== 0n) {
          rows.push({
            trader: feeByTrader.trader,
            token: feeUpdate.token,
            feeType: 'reserveFee',
            amount: feeUpdate.reserveFee,
          })
        }
      }
    }

    status.textContent = `Decoded ${rows.length} amount entries.`
    status.className = 'status success'

    if (rows.length === 0) {
      results.innerHTML = '<p>No fee updates found in calldata.</p>'
      renderReportCheck([], slackReportInput.value)
      return
    }

    renderRows(rows)
    renderReportCheck(rows, slackReportInput.value)
  } catch (error) {
    status.textContent = 'Unable to decode as epochUpdate calldata.'
    status.className = 'status error'
    results.innerHTML = ''
    renderReportCheck([], slackReportInput.value)
  }
}

calldataInput.addEventListener('input', (event) => {
  decodeCalldata(event.target.value)
})

slackReportInput.addEventListener('input', () => {
  decodeCalldata(calldataInput.value)
})

calldataInput.addEventListener('focus', () => {
  calldataInput.select()
})
