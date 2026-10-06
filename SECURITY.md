# Security policy

The initial 0.1.x release receives security fixes. RESPdeck is a single-user administrator tool intended for trusted, self-hosted deployments.

Do not post credentials, real database values, or exploit details publicly. Once this project is published on GitHub, use the repository's **Security → Report a vulnerability** private reporting feature (the maintainer must enable it during publication). Until then, report findings privately to the maintainer through the channel used to obtain the project.

Include the version, configuration, minimal synthetic reproduction, expected boundary, and impact. There is no guaranteed response-time SLA for this personal open-source project.

For deployment and credential handling, see the security section in README.md. If you lose the credential encryption key, restore it from your secret backup or re-enter Redis passwords; there is no recovery backdoor.
