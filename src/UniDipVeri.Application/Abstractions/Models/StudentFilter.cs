using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Application.Abstractions.Models;

public sealed record StudentFilter(
    Guid? ProgramId = null,
    StudentAccountStatus? AccountStatus = null,
    GraduationStatus? GraduationStatus = null,
    WalletStatus? WalletStatus = null,
    string? SearchTerm = null,
    int Page = 1,
    int PageSize = 20
);
