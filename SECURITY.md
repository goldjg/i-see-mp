# Security Notice

## Purpose

ISeeMP is a **security research and analysis tool** designed to help defenders,
security engineers, and red-team practitioners understand the structural risk
in MCP/agent tooling environments. It maps execution paths, classifies
capabilities, and validates prompt-injection candidate paths using deterministic
canary tests — all against infrastructure you own and control.

## Authorised use only

> **You must only run ISeeMP against MCP servers and AI tooling environments
> for which you have explicit written authorisation.**

Acceptable use includes:

- Analysing your own MCP server implementations
- Security reviews of internal or client environments where you hold written
  engagement authorisation
- Controlled lab/CTF environments you own
- Academic or research contexts with appropriate ethics review and approval

## Prohibited use

The following uses are explicitly prohibited and may violate applicable laws
including the Computer Fraud and Abuse Act (CFAA), the UK Computer Misuse Act,
and equivalent legislation in other jurisdictions:

- Scanning MCP servers or AI systems you do not own or have authorisation to
  test
- Using ISeeMP as part of an attack, exploit, or intrusion against any third
  party
- Weaponising findings or canary data to exfiltrate real credentials or data
  from production systems
- Re-distributing ISeeMP as part of an offensive toolkit without clear
  disclosure of its nature and purpose

## Disclaimer

**The authors and contributors of ISeeMP accept no responsibility or liability
for any damage, data loss, legal exposure, or other harm arising from the
use or misuse of this software.**

ISeeMP is provided *as-is*, without warranty of any kind. It is your sole
responsibility to ensure that your use complies with all applicable laws,
regulations, and contractual obligations.

The deliberately vulnerable `examples/dv-mcp` fixture is included **for local
demonstration purposes only**. Do not expose it to untrusted networks.

## Reporting a vulnerability in ISeeMP itself

If you discover a security vulnerability in ISeeMP's own codebase, please
disclose it responsibly by opening a GitHub issue marked **[SECURITY]** or by
contacting the repository owner directly. Do not publish exploit details before
a fix is available.
