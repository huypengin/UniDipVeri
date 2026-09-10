namespace UniDipVeri.Application.Abstractions.Communication;

public interface IEmailSender
{
    Task SendPasswordResetEmailAsync(string email, string recipientName, string resetToken, CancellationToken ct = default);
}
