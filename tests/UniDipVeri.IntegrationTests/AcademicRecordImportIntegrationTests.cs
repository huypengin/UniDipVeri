using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using UniDipVeri.Application.Abstractions.Security;
using UniDipVeri.Application.Features.AcademicRecords.Models;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.Domain.Entities;
using UniDipVeri.Domain.Enums;
using UniDipVeri.Infrastructure.Persistence;

namespace UniDipVeri.IntegrationTests;

[Collection("PostgreSqlIntegrationCollection")]
public class AcademicRecordImportIntegrationTests : IDisposable
{
    private readonly HttpClient _client;
    private readonly IServiceScope _scope;
    private readonly UniDipVeriDbContext _dbContext;
    private readonly IPasswordHasher _passwordHasher;

    private readonly Guid _universityId = Guid.NewGuid();
    private readonly Guid _programId = Guid.NewGuid();
    private readonly string _adminEmail;
    private readonly string _adminPassword = "SecureAdminPassword123!";
    private readonly string _registrarEmail;
    private readonly string _registrarPassword = "SecureRegistrarPassword123!";
    private readonly string _approverEmail;
    private readonly string _approverPassword = "SecureApproverPassword123!";
    private readonly string _studentPassword = "StudentPassword123!";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public AcademicRecordImportIntegrationTests(PostgreSqlTestFixture fixture)
    {
        _client = fixture.Factory.CreateClient();
        _scope = fixture.Factory.Services.CreateScope();
        _dbContext = _scope.ServiceProvider.GetRequiredService<UniDipVeriDbContext>();
        _passwordHasher = _scope.ServiceProvider.GetRequiredService<IPasswordHasher>();

        var suffix = Guid.NewGuid().ToString("N")[..8];
        _adminEmail = $"admin_ar_{suffix}@miu.edu";
        _registrarEmail = $"reg_ar_{suffix}@miu.edu";
        _approverEmail = $"appr_ar_{suffix}@miu.edu";

        SeedTestData(suffix);
    }

    private void SeedTestData(string suffix)
    {
        var university = University.Create($"Uni {suffix}", $"U{suffix}".ToUpperInvariant(), $"{suffix}.miu.edu", id: _universityId);
        _dbContext.Universities.Add(university);

        var program = UniDipVeri.Domain.Entities.Program.Create(
            _universityId,
            $"Computer Science {suffix}",
            $"Bachelor of Science in Computer Science {suffix}",
            DegreeLevel.BACHELOR,
            ProgramStatus.ACTIVE,
            _programId);
        _dbContext.Programs.Add(program);

        var adminHash = _passwordHasher.HashPassword(_adminPassword);
        var adminStaff = UniversityStaff.Create(_universityId, "AR Admin", _adminEmail, adminHash, StaffRole.ADMIN);
        _dbContext.UniversityStaff.Add(adminStaff);

        var regHash = _passwordHasher.HashPassword(_registrarPassword);
        var regStaff = UniversityStaff.Create(_universityId, "AR Registrar", _registrarEmail, regHash, StaffRole.REGISTRAR);
        _dbContext.UniversityStaff.Add(regStaff);

        var apprHash = _passwordHasher.HashPassword(_approverPassword);
        var apprStaff = UniversityStaff.Create(_universityId, "AR Approver", _approverEmail, apprHash, StaffRole.APPROVER);
        _dbContext.UniversityStaff.Add(apprStaff);

        _dbContext.SaveChanges();
    }

    private async Task LoginAsStaffAsync(string email, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/staffs/login", new LoginRequest(email, password));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    private async Task LoginAsStudentAsync(string email, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/students/login", new LoginRequest(email, password));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AcademicRecordImport_FullFlow_EndToEnd()
    {
        var suffix = Guid.NewGuid().ToString("N")[..6];
        var studentNumber = $"STU-{suffix}";
        var sourceRef = $"SIS-REF-{suffix}";
        var studentEmail = $"student_{suffix}@miu.edu";

        // 1. Unauthenticated import returns 401
        var unauthResponse = await _client.PostAsJsonAsync("/api/academic-records/import", new ImportAcademicRecordRequest());
        unauthResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // 2. Admin cannot import (403)
        await LoginAsStaffAsync(_adminEmail, _adminPassword);
        var adminImportResponse = await _client.PostAsJsonAsync("/api/academic-records/import", new ImportAcademicRecordRequest());
        adminImportResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 3. Approver cannot import (403)
        await LoginAsStaffAsync(_approverEmail, _approverPassword);
        var apprImportResponse = await _client.PostAsJsonAsync("/api/academic-records/import", new ImportAcademicRecordRequest());
        apprImportResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 4. Registrar logs in
        await LoginAsStaffAsync(_registrarEmail, _registrarPassword);

        // 4a. Unknown program returns 400 Bad Request
        var invalidProgramPayload = new ImportAcademicRecordRequest
        {
            StudentNumber = studentNumber,
            Name = "Alice Nguyen",
            Email = studentEmail,
            ProgramId = Guid.NewGuid(), // Non-existent program
            CreditsCompleted = 120,
            Gpa = 3.80m,
            CompletedCourses = ["CS101", "CS102"],
            SourceRecordRef = sourceRef
        };
        var invalidProgResponse = await _client.PostAsJsonAsync("/api/academic-records/import", invalidProgramPayload);
        invalidProgResponse.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // 4b. Import new student returns 201 Created with Location header
        var validPayload = new ImportAcademicRecordRequest
        {
            StudentNumber = studentNumber,
            Name = "Alice Nguyen",
            Email = studentEmail,
            ProgramId = _programId,
            CreditsCompleted = 120,
            Gpa = 3.80m,
            CompletedCourses = ["CS101", "CS102"],
            SourceRecordRef = sourceRef
        };

        var createResponse = await _client.PostAsJsonAsync("/api/academic-records/import", validPayload);
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        createResponse.Headers.Location.Should().NotBeNull();

        var createBody = await createResponse.Content.ReadFromJsonAsync<ImportResultResponse>(JsonOptions);
        createBody.Should().NotBeNull();
        createBody!.IsNewStudent.Should().BeTrue();
        createBody.StudentNumber.Should().Be(studentNumber);
        createBody.AccountStatus.Should().Be("PENDING_ACTIVATION");
        createBody.WalletStatus.Should().Be("PENDING");
        createBody.AcademicRecord.CreditsCompleted.Should().Be(120);
        createBody.AcademicRecord.Gpa.Should().Be(3.80m);
        createBody.AcademicRecord.CompletedCourses.Should().Equal("CS101", "CS102");

        var studentId = createBody.StudentId;

        // 5. Registrar can view academic record via GET
        var getResponse = await _client.GetAsync($"/api/students/{studentId}/academic-record");
        getResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var getBody = await getResponse.Content.ReadFromJsonAsync<AcademicRecordResponse>(JsonOptions);
        getBody.Should().NotBeNull();
        getBody!.StudentId.Should().Be(studentId);
        getBody.CreditsCompleted.Should().Be(120);

        // 6. Admin CANNOT view academic record (403 Forbidden per rule)
        await LoginAsStaffAsync(_adminEmail, _adminPassword);
        var adminGetResponse = await _client.GetAsync($"/api/students/{studentId}/academic-record");
        adminGetResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 7. Student access control
        // Set password for student to test student login
        var studentHash = _passwordHasher.HashPassword(_studentPassword);
        var studentEntity = await _dbContext.Students.FindAsync(studentId);
        studentEntity!.SetPassword(studentHash);
        studentEntity.ActivateAccount();
        await _dbContext.SaveChangesAsync();

        // 7a. Student logs in and accesses OWN academic record -> 200 OK
        await LoginAsStudentAsync(studentEmail, _studentPassword);
        var studentSelfResponse = await _client.GetAsync($"/api/students/{studentId}/academic-record");
        studentSelfResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        // 7b. Student accesses another student's record -> 403 Forbidden
        var otherStudentResponse = await _client.GetAsync($"/api/students/{Guid.NewGuid()}/academic-record");
        otherStudentResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // 8. Re-import / update existing student by Registrar
        await LoginAsStaffAsync(_registrarEmail, _registrarPassword);
        var updatePayload = new ImportAcademicRecordRequest
        {
            StudentNumber = studentNumber,
            Name = "Alice Nguyen Updated",
            Email = studentEmail,
            ProgramId = _programId,
            CreditsCompleted = 135,
            Gpa = 3.92m,
            CompletedCourses = ["CS101", "CS102", "CS201", "CS301"],
            SourceRecordRef = sourceRef
        };

        var updateResponse = await _client.PostAsJsonAsync("/api/academic-records/import", updatePayload);
        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateBody = await updateResponse.Content.ReadFromJsonAsync<ImportResultResponse>(JsonOptions);
        updateBody.Should().NotBeNull();
        updateBody!.IsNewStudent.Should().BeFalse();
        updateBody.Name.Should().Be("Alice Nguyen Updated");
        updateBody.AccountStatus.Should().Be("ACTIVE"); // Unchanged
        updateBody.AcademicRecord.CreditsCompleted.Should().Be(135);
        updateBody.AcademicRecord.Gpa.Should().Be(3.92m);
        updateBody.AcademicRecord.CompletedCourses.Should().Equal("CS101", "CS102", "CS201", "CS301");

        // 9. Re-import with mismatched student number returns 409 Conflict
        var mismatchedNumberPayload = updatePayload with { StudentNumber = $"MISMATCH-{suffix}" };
        var conflictResponse = await _client.PostAsJsonAsync("/api/academic-records/import", mismatchedNumberPayload);
        conflictResponse.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    public void Dispose()
    {
        _scope.Dispose();
    }
}
