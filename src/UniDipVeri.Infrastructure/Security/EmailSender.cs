using Microsoft.Extensions.Logging;
using UniDipVeri.Application.Abstractions.Communication;

namespace UniDipVeri.Infrastructure.Security;

public class EmailSender(ILogger<EmailSender> logger) : IEmailSender
{
    private readonly ILogger<EmailSender> _logger = logger;

    public Task SendPasswordResetEmailAsync(string email, string recipientName, string resetToken, CancellationToken ct = default)
    {
        _logger.LogInformation(
            "Password reset dispatched to {Email} ({RecipientName}). Reset token: {ResetToken}",
            email,
            recipientName,
            resetToken);

        return Task.CompletedTask;
    }
}
